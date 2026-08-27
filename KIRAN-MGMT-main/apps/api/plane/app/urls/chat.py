# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path


from plane.app.views import (
    ChatRoomViewSet,
    ChatRoomMemberViewSet,
    ChatRoomReadMarkerViewSet,
    ChatMessageViewSet,
    ChatRoomInviteViewSet,
    ChatInviteJoinViewSet,
    ChatUpdatesViewSet,
    ChatAgentEndpoint,
    ChatUserGroupViewSet,
    ChatOverviewViewSet,
)


urlpatterns = [
    # rooms
    path(
        "workspaces/<str:slug>/chat/rooms/",
        ChatRoomViewSet.as_view({"get": "list", "post": "create"}),
        name="chat-room",
    ),
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:pk>/",
        ChatRoomViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="chat-room",
    ),
    ## End Rooms
    # messages
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:room_id>/messages/",
        ChatMessageViewSet.as_view({"get": "list", "post": "create"}),
        name="chat-room-message",
    ),
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:room_id>/messages/<uuid:pk>/",
        ChatMessageViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"}),
        name="chat-room-message",
    ),
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:room_id>/messages/<uuid:pk>/reactions/",
        ChatMessageViewSet.as_view({"post": "reactions"}),
        name="chat-message-reaction",
    ),
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:room_id>/messages/<uuid:pk>/pin/",
        ChatMessageViewSet.as_view({"post": "pin"}),
        name="chat-message-pin",
    ),
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:room_id>/messages/<uuid:pk>/save/",
        ChatMessageViewSet.as_view({"post": "save_message"}),
        name="chat-message-save",
    ),
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:room_id>/messages/<uuid:pk>/send-now/",
        ChatMessageViewSet.as_view({"post": "send_now"}),
        name="chat-message-send-now",
    ),
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:room_id>/messages/<uuid:pk>/forward/",
        ChatMessageViewSet.as_view({"post": "forward"}),
        name="chat-message-forward",
    ),
    ## End Messages
    # members
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:room_id>/members/",
        ChatRoomMemberViewSet.as_view({"get": "list", "post": "create"}),
        name="chat-room-member",
    ),
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:room_id>/members/<uuid:pk>/",
        ChatRoomMemberViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="chat-room-member",
    ),
    ## End Members
    # read state
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:room_id>/read/",
        ChatRoomReadMarkerViewSet.as_view({"post": "create"}),
        name="chat-room-read",
    ),
    # invites
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:room_id>/invites/",
        ChatRoomInviteViewSet.as_view({"post": "create"}),
        name="chat-room-invite",
    ),
    path(
        "workspaces/<str:slug>/chat/rooms/<uuid:room_id>/invites/<uuid:pk>/",
        ChatRoomInviteViewSet.as_view({"delete": "destroy"}),
        name="chat-room-invite",
    ),
    path(
        "workspaces/<str:slug>/chat/invites/<str:code>/join/",
        ChatInviteJoinViewSet.as_view({"post": "join"}),
        name="chat-invite-join",
    ),
    ## End Invites
    # polling delta -- chat's entire real-time transport
    path(
        "workspaces/<str:slug>/chat/updates/",
        ChatUpdatesViewSet.as_view({"get": "list"}),
        name="chat-updates",
    ),
    # The shell's view of chat: what the rail badge and the command palette
    # need before anyone has opened the app. Cheap on purpose -- see the module
    # docstring in views/chat/overview.py.
    path(
        "workspaces/<str:slug>/chat/overview/",
        ChatOverviewViewSet.as_view({"get": "retrieve"}),
        name="chat-overview",
    ),
    # mention groups -- @engineering and friends. Workspace-scoped, not
    # room-scoped: a handle means the same team wherever it is typed.
    path(
        "workspaces/<str:slug>/chat/groups/",
        ChatUserGroupViewSet.as_view({"get": "list", "post": "create"}),
        name="chat-user-group",
    ),
    path(
        "workspaces/<str:slug>/chat/groups/<uuid:pk>/",
        ChatUserGroupViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="chat-user-group",
    ),
    ## End Groups
    # AI assistant. Not a ViewSet: one verb, no model behind it.
    path(
        "workspaces/<str:slug>/chat/agent/",
        ChatAgentEndpoint.as_view(),
        name="chat-agent",
    ),
]
