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
]
