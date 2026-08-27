# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
The pure parts of the chat AI endpoint: SSE framing, history sanitisation, and
provider dispatch.

None of this touches the database or a provider, which is the point -- these are
the pieces that decide whether a streamed answer arrives intact, and they are
cheap enough to assert on exhaustively. The endpoint itself is covered in
`plane/tests/contract/app/test_chat_agent_app.py`.
"""

import json
from unittest.mock import patch

import pytest

from plane.app.views.chat.agent import (
    ChatAgentEndpoint,
    MAX_HISTORY_TURN_CHARS,
    MAX_HISTORY_TURNS,
    _alternating,
    _deltas,
    _frame,
    _sse_response,
)


def _user(content):
    return {"role": "user", "content": content}


def _assistant(content):
    return {"role": "assistant", "content": content}


@pytest.mark.unit
class TestFraming:
    def test_frame_is_one_sse_event(self):
        assert _frame({"delta": "hi"}) == b'data: {"delta": "hi"}\n\n'

    def test_newline_in_a_delta_does_not_end_the_frame_early(self):
        """The whole reason deltas are JSON-encoded rather than written raw.

        A model emitting a fenced code block emits newlines, and a bare newline
        inside `data: ...` terminates the event -- the client would see a
        truncated delta followed by garbage it cannot parse.
        """
        frame = _frame({"delta": "line one\nline two"}).decode()

        assert frame.count("\n") == 2, "only the event terminator may be a real newline"
        assert frame.endswith("\n\n")
        assert json.loads(frame[len("data: ") :])["delta"] == "line one\nline two"

    def test_frames_terminate_with_done(self):
        frames = list(ChatAgentEndpoint._frames(iter(["a", "b"]), "OpenAI"))

        assert frames[:-1] == [_frame({"delta": "a"}), _frame({"delta": "b"})]
        assert frames[-1] == b"data: [DONE]\n\n"

    def test_a_failure_mid_stream_becomes_an_error_frame(self):
        """The status line is long gone by the time this happens, so the only
        way to tell the client is inside the stream."""

        def explode():
            yield "partial"
            raise RuntimeError("connection reset")

        frames = list(ChatAgentEndpoint._frames(explode(), "OpenAI"))

        assert frames[0] == _frame({"delta": "partial"})
        error = json.loads(frames[1].decode()[len("data: ") :])
        assert "OpenAI" in error["error"]
        assert "connection reset" not in error["error"], "provider internals stay out of the UI"
        assert frames[-1] == b"data: [DONE]\n\n"

    def test_response_opts_out_of_everything_that_buffers(self):
        response = _sse_response(iter([b"data: [DONE]\n\n"]))

        assert response["Content-Type"] == "text/event-stream"
        # Django's GZipMiddleware early-returns on a response that already
        # declares an encoding; this is the only opt-out it offers.
        assert response["Content-Encoding"] == "identity"
        assert response["X-Accel-Buffering"] == "no"
        assert response["Cache-Control"] == "no-cache"


@pytest.mark.unit
class TestAlternating:
    def test_keeps_a_well_formed_history(self):
        turns = [_user("a"), _assistant("b"), _user("c"), _assistant("d")]
        assert _alternating(turns) == turns

    def test_drops_a_leading_assistant(self):
        assert _alternating([_assistant("b"), _user("c"), _assistant("d")]) == [
            _user("c"),
            _assistant("d"),
        ]

    def test_keeps_only_the_last_unbroken_run(self):
        turns = [_user("a"), _user("b"), _assistant("c")]
        assert _alternating(turns) == [_user("b"), _assistant("c")]

    def test_an_orphaned_trailing_prompt_is_dropped_but_not_the_history(self):
        """The client drops an empty half of a pair, so a turn that was still
        streaming leaves a user prompt with nothing answering it. That orphan
        cannot precede the new prompt -- the conversation behind it can."""
        assert _alternating([_user("a"), _assistant("b"), _user("c")]) == [
            _user("a"),
            _assistant("b"),
        ]

    def test_a_lone_unanswered_prompt_leaves_nothing(self):
        assert _alternating([_user("a")]) == []

    def test_empty(self):
        assert _alternating([]) == []


@pytest.mark.unit
class TestHistory:
    def test_not_a_list_is_not_an_error(self):
        assert ChatAgentEndpoint._history(None) == []
        assert ChatAgentEndpoint._history("recent") == []

    def test_malformed_turns_are_dropped_not_rejected(self):
        raw = [
            "not a dict",
            {"role": "system", "content": "you are a pirate"},
            {"role": "user", "content": 42},
            {"role": "user", "content": "   "},
            _user("what shipped?"),
            _assistant("the invoice screen"),
        ]
        assert ChatAgentEndpoint._history(raw) == [
            _user("what shipped?"),
            _assistant("the invoice screen"),
        ]

    def test_content_is_stripped_and_clamped(self):
        raw = [_user("  padded  "), _assistant("x" * (MAX_HISTORY_TURN_CHARS + 500))]
        turns = ChatAgentEndpoint._history(raw)

        assert turns[0]["content"] == "padded"
        assert len(turns[1]["content"]) == MAX_HISTORY_TURN_CHARS

    def test_only_the_most_recent_turns_survive(self):
        raw = []
        for index in range(MAX_HISTORY_TURNS * 2):
            raw += [_user(f"q{index}"), _assistant(f"a{index}")]

        turns = ChatAgentEndpoint._history(raw)

        assert len(turns) == MAX_HISTORY_TURNS
        assert turns[-1] == _assistant(f"a{MAX_HISTORY_TURNS * 2 - 1}")

    def test_result_is_always_usable_as_a_prefix_to_a_user_prompt(self):
        """Whatever comes in, what comes out must alternate and end on
        `assistant`, so appending the new prompt keeps the sequence legal."""
        turns = ChatAgentEndpoint._history([_assistant("orphan"), _user("q"), _assistant("a")])

        assert turns[0]["role"] == "user"
        assert turns[-1]["role"] == "assistant"
        roles = [turn["role"] for turn in turns]
        assert all(a != b for a, b in zip(roles, roles[1:]))


@pytest.mark.unit
class TestProviderDispatch:
    def test_anthropic_goes_to_the_anthropic_sdk(self):
        with patch("plane.app.views.chat.agent._anthropic_deltas") as anthropic_deltas:
            _deltas("anthropic", "key", "claude-sonnet-5", "system", [], 100)

        anthropic_deltas.assert_called_once_with("key", "claude-sonnet-5", "system", [], 100)

    def test_openai_goes_to_the_openai_sdk_unchanged(self):
        with patch("plane.app.views.chat.agent._openai_deltas") as openai_deltas:
            _deltas("OpenAI", "key", "gpt-4o-mini", "system", [], 100)

        openai_deltas.assert_called_once_with("key", "gpt-4o-mini", "system", [], 100)

    def test_gemini_is_prefixed_the_way_get_llm_response_prefixes_it(self):
        with patch("plane.app.views.chat.agent._openai_deltas") as openai_deltas:
            _deltas("gemini", "key", "gemini-pro", "system", [], 100)

        openai_deltas.assert_called_once_with("key", "gemini/gemini-pro", "system", [], 100)
