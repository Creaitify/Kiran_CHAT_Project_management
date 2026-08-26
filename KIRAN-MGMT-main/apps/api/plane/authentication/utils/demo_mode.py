# KCMS demo mode.
#
# When DEMO_MODE=1 the instance stops gate-keeping sign in: any email + any
# password gets you in, the account is created on the fly if it does not exist,
# onboarding is pre-completed and the user is dropped straight into the demo
# workspace as an admin.
#
# This is for the local KCMS demo only. Never enable it on an instance that is
# reachable from outside the demo machine.

import os

DEMO_WORKSPACE_SLUG = os.environ.get("DEMO_WORKSPACE_SLUG", "kiran")


def is_demo_mode():
    """True when the instance is running as an open demo.

    Gated on DEBUG as well as DEMO_MODE. Setting DEMO_MODE=1 on a staging or
    production instance -- where DEBUG is off -- therefore cannot silently turn
    off authentication; the flag only has an effect on a local dev instance.
    """
    if os.environ.get("DEMO_MODE", "0") != "1":
        return False

    # Imported lazily so this module stays importable before settings are ready.
    from django.conf import settings

    return bool(getattr(settings, "DEBUG", False))


def provision_demo_user(user):
    """Onboard `user` and give them admin access to the demo workspace."""
    if not is_demo_mode() or user is None:
        return user

    # Imported lazily so this module stays importable before the app registry is ready.
    from plane.db.models import Profile, Project, ProjectMember, Workspace, WorkspaceMember

    workspace = Workspace.objects.filter(slug=DEMO_WORKSPACE_SLUG).first()

    profile, _ = Profile.objects.get_or_create(user=user)
    profile.is_onboarded = True
    profile.is_tour_completed = True
    profile.onboarding_step = {
        "workspace_join": True,
        "profile_complete": True,
        "workspace_create": True,
        "workspace_invite": True,
    }
    if workspace:
        profile.last_workspace_id = workspace.id
    profile.save()

    if not user.is_active:
        user.is_active = True
        user.save(update_fields=["is_active"])

    if workspace is None:
        return user

    WorkspaceMember.objects.get_or_create(
        workspace=workspace,
        member=user,
        defaults={"role": 20, "is_active": True},
    )

    for project in Project.objects.filter(workspace=workspace):
        ProjectMember.objects.get_or_create(
            project=project,
            member=user,
            defaults={"role": 20, "is_active": True},
        )

    return user
