# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python import
import os
from typing import List, Dict, Tuple

# Third party import
import anthropic
from openai import OpenAI
import requests

from rest_framework import status
from rest_framework.response import Response

# Module import
from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import ProjectLiteSerializer, WorkspaceLiteSerializer
from plane.db.models import Project, Workspace
from plane.license.utils.instance_value import get_configuration_value
from plane.utils.exception_logger import log_exception

from ..base import BaseAPIView


class LLMProvider:
    """Base class for LLM provider configurations"""

    name: str = ""
    models: List[str] = []
    default_model: str = ""

    @classmethod
    def get_config(cls) -> Dict[str, str | List[str]]:
        return {
            "name": cls.name,
            "models": cls.models,
            "default_model": cls.default_model,
        }


class OpenAIProvider(LLMProvider):
    name = "OpenAI"
    models = ["gpt-3.5-turbo", "gpt-4o-mini", "gpt-4o", "o1-mini", "o1-preview"]
    default_model = "gpt-4o-mini"


class AnthropicProvider(LLMProvider):
    name = "Anthropic"
    # Suggestions for the admin dropdown, not a whitelist. get_llm_config warns on
    # an unlisted model but still sends it, so a Claude model released after this
    # deploy can be configured without a code change.
    models = [
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-opus-4-8",
        "claude-sonnet-4-6",
        "claude-haiku-4-5",
    ]
    default_model = "claude-sonnet-5"


class GeminiProvider(LLMProvider):
    name = "Gemini"
    models = ["gemini-pro", "gemini-1.5-pro-latest", "gemini-pro-vision"]
    default_model = "gemini-pro"


SUPPORTED_PROVIDERS = {
    "openai": OpenAIProvider,
    "anthropic": AnthropicProvider,
    "gemini": GeminiProvider,
}


def get_llm_config() -> Tuple[str | None, str | None, str | None]:
    """
    Helper to get LLM configuration values, returns:
        - api_key, model, provider
    """
    api_key, provider_key, model = get_configuration_value(
        [
            {
                "key": "LLM_API_KEY",
                "default": os.environ.get("LLM_API_KEY", None),
            },
            {
                "key": "LLM_PROVIDER",
                "default": os.environ.get("LLM_PROVIDER", "openai"),
            },
            {
                "key": "LLM_MODEL",
                "default": os.environ.get("LLM_MODEL", None),
            },
        ]
    )

    provider = SUPPORTED_PROVIDERS.get(provider_key.lower())
    if not provider:
        log_exception(ValueError(f"Unsupported provider: {provider_key}"))
        return None, None, None

    if not api_key:
        log_exception(ValueError(f"Missing API key for provider: {provider.name}"))
        return None, None, None

    # If no model specified, use provider's default
    if not model:
        model = provider.default_model

    # `provider.models` is a suggestion list, not a whitelist. Warn on an unknown
    # model but still let it through -- hard-rejecting here meant every new model
    # release broke a working configuration until the code was updated.
    if model not in provider.models:
        log_exception(
            ValueError(
                f"Model {model} is not in the known list for {provider.name}. "
                f"Known models: {', '.join(provider.models)}. Sending it anyway."
            )
        )

    return api_key, model, provider_key


# Non-streaming ceiling: high enough that answers are never truncated mid-sentence,
# low enough to stay well inside the SDK's default HTTP timeout.
LLM_MAX_TOKENS = 16000


def _anthropic_response(final_text: str, api_key: str, model: str) -> str | None:
    """Generate a completion through the official Anthropic SDK."""
    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=model,
        max_tokens=LLM_MAX_TOKENS,
        messages=[{"role": "user", "content": final_text}],
    )
    # `content` is a list of blocks; only the text ones carry the answer.
    return "".join(block.text for block in message.content if block.type == "text") or None


def _openai_response(final_text: str, api_key: str, model: str) -> str | None:
    """Generate a completion through the OpenAI-compatible chat completions API."""
    client = OpenAI(api_key=api_key)
    chat_completion = client.chat.completions.create(
        model=model, messages=[{"role": "user", "content": final_text}]
    )
    return chat_completion.choices[0].message.content


def llm_error_message(exc: Exception, provider: str) -> str:
    """Map a provider SDK exception onto a message that is safe to show a user.

    Logs the original, then returns a sentence naming the provider and, where the
    SDK made it knowable, the thing an admin would have to change. Anything
    unrecognised collapses to the generic line rather than leaking a stack detail
    or a key fragment into the UI.

    Split out of `get_llm_response` so the streaming chat agent
    (`plane.app.views.chat.agent`) reports failures in the same words: the two
    call paths differ in how they transport a token, not in what "your API key is
    wrong" means.
    """
    log_exception(exc)

    if isinstance(exc, anthropic.AuthenticationError):
        return f"Invalid API key for {provider}"
    if isinstance(exc, anthropic.RateLimitError):
        return f"Rate limit exceeded for {provider}"
    if isinstance(exc, anthropic.BadRequestError):
        return f"{provider} rejected the request -- check the configured model name"

    # The OpenAI SDK raises its own classes that happen to share these names.
    error_type = exc.__class__.__name__
    if error_type == "AuthenticationError":
        return f"Invalid API key for {provider}"
    if error_type == "RateLimitError":
        return f"Rate limit exceeded for {provider}"
    if error_type in ("BadRequestError", "NotFoundError"):
        return f"{provider} rejected the request -- check the configured model name"
    return f"Error occurred while generating response from {provider}"


def get_llm_response(task, prompt, api_key: str, model: str, provider: str) -> Tuple[str | None, str | None]:
    """Helper to get LLM completion response"""
    final_text = task + "\n" + prompt
    try:
        if provider.lower() == "anthropic":
            text = _anthropic_response(final_text, api_key, model)
        else:
            # For Gemini, prepend provider name to model
            if provider.lower() == "gemini":
                model = f"gemini/{model}"
            text = _openai_response(final_text, api_key, model)
        return text, None
    except Exception as e:
        return None, llm_error_message(e, provider)


class GPTIntegrationEndpoint(BaseAPIView):
    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def post(self, request, slug, project_id):
        api_key, model, provider = get_llm_config()

        if not api_key or not model or not provider:
            return Response(
                {"error": "LLM provider API key and model are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        task = request.data.get("task", False)
        if not task:
            return Response({"error": "Task is required"}, status=status.HTTP_400_BAD_REQUEST)

        text, error = get_llm_response(task, request.data.get("prompt", False), api_key, model, provider)
        if not text and error:
            return Response(
                {"error": "An internal error has occurred."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        workspace = Workspace.objects.get(slug=slug)
        project = Project.objects.get(pk=project_id)

        return Response(
            {
                "response": text,
                "response_html": text.replace("\n", "<br/>"),
                "project_detail": ProjectLiteSerializer(project).data,
                "workspace_detail": WorkspaceLiteSerializer(workspace).data,
            },
            status=status.HTTP_200_OK,
        )


class WorkspaceGPTIntegrationEndpoint(BaseAPIView):
    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        api_key, model, provider = get_llm_config()

        if not api_key or not model or not provider:
            return Response(
                {"error": "LLM provider API key and model are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        task = request.data.get("task", False)
        if not task:
            return Response({"error": "Task is required"}, status=status.HTTP_400_BAD_REQUEST)

        text, error = get_llm_response(task, request.data.get("prompt", False), api_key, model, provider)
        if not text and error:
            return Response(
                {"error": "An internal error has occurred."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response(
            {
                "response": text,
                "response_html": text.replace("\n", "<br/>"),
            },
            status=status.HTTP_200_OK,
        )


class RephraseGrammarEndpoint(BaseAPIView):
    """Rich-text editor assistant.

    The editor posts {task, text_input} here and renders the returned `response`
    inline. Kept separate from the workspace assistant because the payload shape
    and the response contract differ.
    """

    TASK_INSTRUCTIONS = {
        "ASK_ANYTHING": (
            "You are a writing assistant inside a project management tool. "
            "Respond to the request below. Return only the resulting text, with no "
            "preamble, commentary, or surrounding quotation marks."
        )
    }

    @allow_permission(allowed_roles=[ROLE.ADMIN, ROLE.MEMBER], level="WORKSPACE")
    def post(self, request, slug):
        api_key, model, provider = get_llm_config()

        if not api_key or not model or not provider:
            return Response(
                {"error": "LLM provider API key and model are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        text_input = request.data.get("text_input", False)
        if not text_input:
            return Response({"error": "text_input is required"}, status=status.HTTP_400_BAD_REQUEST)

        task = request.data.get("task", "ASK_ANYTHING")
        instruction = self.TASK_INSTRUCTIONS.get(task, self.TASK_INSTRUCTIONS["ASK_ANYTHING"])

        text, error = get_llm_response(instruction, text_input, api_key, model, provider)
        if not text and error:
            return Response(
                {"error": "An internal error has occurred."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        return Response({"response": text}, status=status.HTTP_200_OK)


class UnsplashEndpoint(BaseAPIView):
    def get(self, request):
        (UNSPLASH_ACCESS_KEY,) = get_configuration_value(
            [
                {
                    "key": "UNSPLASH_ACCESS_KEY",
                    "default": os.environ.get("UNSPLASH_ACCESS_KEY"),
                }
            ]
        )
        # Check unsplash access key
        if not UNSPLASH_ACCESS_KEY:
            return Response([], status=status.HTTP_200_OK)

        # Query parameters
        query = request.GET.get("query", False)
        page = request.GET.get("page", 1)
        per_page = request.GET.get("per_page", 20)

        url = (
            f"https://api.unsplash.com/search/photos/?client_id={UNSPLASH_ACCESS_KEY}&query={query}&page=${page}&per_page={per_page}"
            if query
            else f"https://api.unsplash.com/photos/?client_id={UNSPLASH_ACCESS_KEY}&page={page}&per_page={per_page}"
        )

        headers = {"Content-Type": "application/json"}

        resp = requests.get(url=url, headers=headers)
        return Response(resp.json(), status=resp.status_code)
