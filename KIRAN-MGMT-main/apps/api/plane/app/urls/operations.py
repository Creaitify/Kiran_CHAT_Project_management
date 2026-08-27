# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.urls import path

from plane.app.views import (
    CostReportViewSet,
    DepartmentViewSet,
    MemberRateViewSet,
    ProjectLinkViewSet,
    ReminderViewSet,
    ReportRunViewSet,
    ReportScheduleViewSet,
    TimeEntryViewSet,
)


urlpatterns = [
    # departments -- the dimension everything else reports by
    path(
        "workspaces/<str:slug>/operations/departments/",
        DepartmentViewSet.as_view({"get": "list", "post": "create"}),
        name="operations-department",
    ),
    path(
        "workspaces/<str:slug>/operations/departments/<uuid:pk>/",
        DepartmentViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="operations-department",
    ),
    path(
        "workspaces/<str:slug>/operations/departments/<uuid:pk>/projects/",
        DepartmentViewSet.as_view({"post": "projects"}),
        name="operations-department-projects",
    ),
    ## End Departments
    # cross-department project links
    path(
        "workspaces/<str:slug>/operations/links/",
        ProjectLinkViewSet.as_view({"get": "list", "post": "create"}),
        name="operations-project-link",
    ),
    path(
        "workspaces/<str:slug>/operations/links/<uuid:pk>/",
        ProjectLinkViewSet.as_view({"delete": "destroy"}),
        name="operations-project-link",
    ),
    path(
        "workspaces/<str:slug>/operations/links/<uuid:pk>/confirm/",
        ProjectLinkViewSet.as_view({"post": "confirm"}),
        name="operations-project-link-confirm",
    ),
    ## End Links
    # time
    path(
        "workspaces/<str:slug>/operations/time/",
        TimeEntryViewSet.as_view({"get": "list", "post": "create"}),
        name="operations-time-entry",
    ),
    path(
        "workspaces/<str:slug>/operations/time/<uuid:pk>/",
        TimeEntryViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="operations-time-entry",
    ),
    ## End Time
    # rates and cost
    path(
        "workspaces/<str:slug>/operations/rates/",
        MemberRateViewSet.as_view({"get": "list", "post": "create"}),
        name="operations-member-rate",
    ),
    path(
        "workspaces/<str:slug>/operations/rates/<uuid:pk>/",
        MemberRateViewSet.as_view({"delete": "destroy"}),
        name="operations-member-rate",
    ),
    path(
        "workspaces/<str:slug>/operations/cost/",
        CostReportViewSet.as_view({"get": "list"}),
        name="operations-cost",
    ),
    ## End Cost
    # scheduled reports
    path(
        "workspaces/<str:slug>/operations/report-schedules/",
        ReportScheduleViewSet.as_view({"get": "list", "post": "create"}),
        name="operations-report-schedule",
    ),
    path(
        "workspaces/<str:slug>/operations/report-schedules/<uuid:pk>/",
        ReportScheduleViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="operations-report-schedule",
    ),
    path(
        "workspaces/<str:slug>/operations/report-schedules/<uuid:pk>/preview/",
        ReportScheduleViewSet.as_view({"get": "preview"}),
        name="operations-report-preview",
    ),
    path(
        "workspaces/<str:slug>/operations/reports/",
        ReportRunViewSet.as_view({"get": "list"}),
        name="operations-report-run",
    ),
    path(
        "workspaces/<str:slug>/operations/reports/<uuid:pk>/",
        ReportRunViewSet.as_view({"get": "retrieve"}),
        name="operations-report-run",
    ),
    ## End Reports
    # reminders
    path(
        "workspaces/<str:slug>/operations/reminders/",
        ReminderViewSet.as_view({"get": "list", "post": "create"}),
        name="operations-reminder",
    ),
    path(
        "workspaces/<str:slug>/operations/reminders/<uuid:pk>/",
        ReminderViewSet.as_view({"patch": "partial_update", "delete": "destroy"}),
        name="operations-reminder",
    ),
    path(
        "workspaces/<str:slug>/operations/reminders/<uuid:pk>/dismiss/",
        ReminderViewSet.as_view({"post": "dismiss"}),
        name="operations-reminder-dismiss",
    ),
    ## End Reminders
]
