# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from rest_framework.throttling import UserRateThrottle


class ChatAgentRateThrottle(UserRateThrottle):
    """Per-user ceiling on the chat AI endpoint.

    The client keeps a token budget of its own (`AI_TOKEN_BUDGET` in
    `chat-store.tsx`), but that lives in a browser tab and resets when the tab
    does, so it is a courtesy to the user rather than a limit on the account.
    This is the limit: every call to the agent endpoint costs money at a
    provider, and the only identity that can be trusted to key that on is the
    authenticated session.

    `UserRateThrottle` uses the configured cache, so this holds across workers
    on a shared Redis and degrades to per-process on LocMem. Rate comes from
    `DEFAULT_THROTTLE_RATES["chat_agent"]`.
    """

    scope = "chat_agent"
