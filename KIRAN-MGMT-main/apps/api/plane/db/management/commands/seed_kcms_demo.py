# Seeds the Kiran Cable Management System (KCMS) demo workspace.
#
#   python manage.py seed_kcms_demo --settings=plane.settings.local
#
# Idempotent: re-running it tops the data back up without duplicating rows.

import os
import random
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from plane.db.models import (
    DEFAULT_STATES,
    Cycle,
    CycleIssue,
    Issue,
    IssueAssignee,
    IssueLabel,
    Label,
    Module,
    ModuleIssue,
    Project,
    ProjectIdentifier,
    ProjectMember,
    Profile,
    State,
    User,
    Workspace,
    WorkspaceMember,
)
from plane.license.models import Instance, InstanceAdmin

WORKSPACE_NAME = "Kiran Cable Protection"
WORKSPACE_SLUG = "kiran"

DEMO_USERS = [
    ("admin@kirancableppl.com", "Kiran", "Admin", "Kiran Admin"),
    ("kavitha@kirancableppl.com", "Kavitha", "Malve", "Kavitha Malve"),
    ("production@kirancableppl.com", "Ravi", "Kumar", "Ravi Kumar"),
    ("quality@kirancableppl.com", "Sneha", "Rao", "Sneha Rao"),
    ("dispatch@kirancableppl.com", "Imran", "Shaikh", "Imran Shaikh"),
]

# No credential in source. Set DEMO_PASSWORD to pin one across re-runs, otherwise
# a fresh random password is generated and printed at the end of the command.
DEMO_PASSWORD = os.environ.get("DEMO_PASSWORD") or secrets.token_urlsafe(12)

PROJECTS = [
    {
        "name": "Cable Tray Production",
        "identifier": "CTP",
        "description": "Perforated, ladder and solid-bottom cable tray manufacturing runs.",
        "labels": ["Hot Dip Galvanised", "Pre-Galvanised", "Powder Coated", "Rework"],
        "modules": ["Perforated Tray Line", "Ladder Tray Line", "Surface Treatment"],
        "cycles": ["Week 34 Production", "Week 35 Production"],
        "issues": [
            ("Roll-form 300mm perforated tray - order KCP-2291", "urgent", "Started"),
            ("Ladder tray rung welding jig calibration", "high", "Started"),
            ("Hot dip galvanising batch for tray lot 4471", "high", "Todo"),
            ("Powder coating oven temperature drift", "urgent", "Started"),
            ("Sheet metal 2mm GI coil shortage - line 2", "high", "Todo"),
            ("Scrap rate above 4% on ladder line", "medium", "Todo"),
            ("Tray bend radius out of tolerance - lot 4468", "high", "Done"),
            ("Line 3 shift handover checklist rollout", "low", "Backlog"),
            ("Replace worn punching die - 100mm tray", "medium", "Todo"),
            ("Monthly production capacity review", "medium", "Backlog"),
        ],
    },
    {
        "name": "Quality & Compliance",
        "identifier": "QC",
        "description": "Inspection, test certificates and IS/IEC compliance for despatched lots.",
        "labels": ["IS 2629", "Salt Spray", "Customer Complaint", "Audit"],
        "modules": ["Incoming Inspection", "In-Process QC", "Certification"],
        "cycles": ["August Compliance Sprint"],
        "issues": [
            ("Zinc coating thickness below 70 micron - lot 4463", "urgent", "Started"),
            ("Salt spray test report pending for L&T order", "high", "Todo"),
            ("Update IS 2629 test certificate template", "medium", "Todo"),
            ("Customer complaint - burr on tray edges (Tata Projects)", "urgent", "Started"),
            ("Calibrate coating thickness gauge", "medium", "Done"),
            ("Internal audit findings - closure plan", "high", "Todo"),
            ("Third-party inspection scheduling for Sept", "low", "Backlog"),
            ("Material test certificate archive digitisation", "low", "Backlog"),
        ],
    },
    {
        "name": "Orders & Dispatch",
        "identifier": "OD",
        "description": "Sales orders, packing, transport and site delivery tracking.",
        "labels": ["Export", "Domestic", "Urgent Delivery", "Payment Pending"],
        "modules": ["Order Processing", "Packing & Loading", "Transport"],
        "cycles": ["August Despatch"],
        "issues": [
            ("Despatch 1200m perforated tray to Hyderabad metro site", "urgent", "Started"),
            ("Export documentation for Sri Lanka consignment", "high", "Todo"),
            ("Packing list mismatch - invoice KCP/24/1188", "high", "Started"),
            ("Arrange 32ft trailer for Chennai delivery", "medium", "Todo"),
            ("Payment follow-up - Ashoka Buildcon", "medium", "Todo"),
            ("Site delivery confirmation - Secunderabad", "low", "Done"),
            ("Revise freight rate card for Q3", "low", "Backlog"),
            ("Customer PO backlog reconciliation", "medium", "Backlog"),
        ],
    },
    {
        "name": "Plant Maintenance",
        "identifier": "PM",
        "description": "Preventive and breakdown maintenance for plant machinery.",
        "labels": ["Breakdown", "Preventive", "Spares", "Safety"],
        "modules": ["Preventive Schedule", "Breakdown Response"],
        "cycles": ["August Maintenance"],
        "issues": [
            ("Press brake hydraulic leak - line 1", "urgent", "Started"),
            ("Monthly preventive maintenance - roll former", "medium", "Todo"),
            ("Order spare bearings for decoiler", "high", "Todo"),
            ("Compressor pressure drop investigation", "high", "Started"),
            ("Fire extinguisher refill and safety audit", "medium", "Todo"),
            ("Replace galvanising kettle thermocouple", "high", "Done"),
            ("Annual electrical safety inspection", "low", "Backlog"),
        ],
    },
]


class Command(BaseCommand):
    help = "Seed the KCMS demo workspace with users, projects and work items."

    def add_arguments(self, parser):
        parser.add_argument(
            "--bulk",
            type=int,
            default=0,
            metavar="N",
            help=(
                "Top the first project up to N work items with generated filler. "
                "The hand-written items above are realistic but too few to make "
                "the spreadsheet scroll, fill a kanban column or draw a gantt bar "
                "chart — which is where row-level rendering defects actually show. "
                "60 is enough. Idempotent: only creates what is missing."
            ),
        )

    def handle(self, *args, **options):
        # Demo data creates users with a known password and grants them broad
        # access, so refuse to run anywhere that is not a local dev instance.
        if not settings.DEBUG:
            raise CommandError(
                "seed_kcms_demo only runs with DEBUG=True. Refusing to seed demo "
                "users and credentials on a non-local instance."
            )

        random.seed(42)
        now = timezone.now()

        # ------------------------------------------------------------------ instance
        instance = Instance.objects.first()
        if instance is None:
            self.stdout.write(self.style.ERROR("No instance row found. Run register_instance first."))
            return
        instance.instance_name = "Kiran Cable Management System"
        instance.is_setup_done = True
        instance.save()
        self.stdout.write(f"instance: {instance.instance_name} (setup done)")

        # ------------------------------------------------------------------- users
        users = []
        for email, first, last, display in DEMO_USERS:
            user, created = User.objects.get_or_create(
                email=email,
                defaults={
                    "username": email,
                    "first_name": first,
                    "last_name": last,
                    "display_name": display,
                    "is_active": True,
                    "is_email_verified": True,
                    "is_password_autoset": False,
                },
            )
            user.first_name = first
            user.last_name = last
            user.display_name = display
            user.is_active = True
            user.is_email_verified = True
            user.set_password(DEMO_PASSWORD)
            user.save()

            profile, _ = Profile.objects.get_or_create(user=user)
            profile.is_onboarded = True
            profile.is_tour_completed = True
            profile.onboarding_step = {
                "workspace_join": True,
                "profile_complete": True,
                "workspace_create": True,
                "workspace_invite": True,
            }
            profile.save()
            users.append(user)
            self.stdout.write(f"user: {email} ({'created' if created else 'updated'})")

        owner = users[0]
        InstanceAdmin.objects.get_or_create(instance=instance, user=owner, defaults={"role": 20})

        # --------------------------------------------------------------- workspace
        workspace, _ = Workspace.objects.get_or_create(
            slug=WORKSPACE_SLUG,
            defaults={"name": WORKSPACE_NAME, "owner": owner, "organization_size": "51-200"},
        )
        workspace.name = WORKSPACE_NAME
        workspace.owner = owner
        workspace.save()

        for user in users:
            WorkspaceMember.objects.get_or_create(
                workspace=workspace,
                member=user,
                defaults={"role": 20, "is_active": True},
            )
            Profile.objects.filter(user=user).update(last_workspace_id=workspace.id)
        self.stdout.write(f"workspace: {workspace.name} (/{workspace.slug}) with {len(users)} members")

        # ---------------------------------------------------------------- projects
        for spec in PROJECTS:
            project, created = Project.objects.get_or_create(
                workspace=workspace,
                identifier=spec["identifier"],
                defaults={
                    "name": spec["name"],
                    "description": spec["description"],
                    "network": 2,
                    "project_lead": random.choice(users),
                    "created_by": owner,
                    "cycle_view": True,
                    "module_view": True,
                    "issue_views_view": True,
                    "page_view": True,
                    "intake_view": True,
                },
            )
            ProjectIdentifier.objects.get_or_create(
                workspace=workspace,
                name=spec["identifier"],
                defaults={"project": project},
            )

            for user in users:
                ProjectMember.objects.get_or_create(
                    project=project,
                    member=user,
                    defaults={"role": 20, "is_active": True},
                )

            if not State.objects.filter(project=project).exists():
                State.objects.bulk_create([
                    State(
                        name=s["name"],
                        color=s["color"],
                        project=project,
                        sequence=s["sequence"],
                        workspace=workspace,
                        group=s["group"],
                        default=s.get("default", False),
                        created_by=owner,
                    )
                    for s in DEFAULT_STATES
                ])

            states = {s.name: s for s in State.objects.filter(project=project)}
            fallback_state = State.objects.filter(project=project, default=True).first() or next(
                iter(states.values())
            )

            labels = {}
            palette = ["#E11D48", "#0EA5E9", "#F59E0B", "#22C55E", "#8B5CF6", "#64748B"]
            for idx, label_name in enumerate(spec["labels"]):
                label, _ = Label.objects.get_or_create(
                    project=project,
                    name=label_name,
                    defaults={"workspace": workspace, "color": palette[idx % len(palette)]},
                )
                labels[label_name] = label

            cycles = []
            for idx, cycle_name in enumerate(spec["cycles"]):
                cycle, _ = Cycle.objects.get_or_create(
                    project=project,
                    name=cycle_name,
                    defaults={
                        "workspace": workspace,
                        "owned_by": owner,
                        "start_date": (now - timedelta(days=7 - idx * 7)).date(),
                        "end_date": (now + timedelta(days=7 + idx * 7)).date(),
                    },
                )
                cycles.append(cycle)

            modules = []
            for module_name in spec["modules"]:
                module, _ = Module.objects.get_or_create(
                    project=project,
                    name=module_name,
                    defaults={
                        "workspace": workspace,
                        "created_by": owner,
                        "status": "in-progress",
                        "start_date": (now - timedelta(days=10)).date(),
                        "target_date": (now + timedelta(days=20)).date(),
                    },
                )
                modules.append(module)

            # Filler for the first project only, so the dense views have enough
            # rows to reveal scroll and rendering defects. Deliberately mundane
            # titles — they should read as volume, not as content worth reading.
            planned = list(spec["issues"])
            bulk = options.get("bulk") or 0
            if bulk and spec is PROJECTS[0]:
                priorities = ["urgent", "high", "medium", "low", "none"]
                state_names = [s["name"] for s in DEFAULT_STATES]
                held = set(
                    Issue.objects.filter(project=project).values_list("name", flat=True)
                ) | {title for title, _, _ in planned}
                # Walk the counter until the project would hold `bulk` distinct
                # items. Counting rather than ranging keeps this idempotent
                # whatever a previous run happened to create.
                n = 0
                while len(held) < bulk and n < bulk * 4:
                    n += 1
                    title = f"Tray lot {4400 + n} — line check and coating record"
                    if title in held:
                        continue
                    held.add(title)
                    planned.append((
                        title,
                        priorities[n % len(priorities)],
                        state_names[n % len(state_names)],
                    ))

            made = 0
            for title, priority, state_name in planned:
                if Issue.objects.filter(project=project, name=title).exists():
                    continue
                state = states.get(state_name, fallback_state)
                issue = Issue.objects.create(
                    project=project,
                    workspace=workspace,
                    name=title,
                    description_html=f"<p>{spec['name']} — {title}.</p>",
                    priority=priority,
                    state=state,
                    created_by=random.choice(users),
                    target_date=(now + timedelta(days=random.randint(2, 30))).date(),
                )
                IssueAssignee.objects.get_or_create(
                    issue=issue,
                    assignee=random.choice(users),
                    defaults={"project": project, "workspace": workspace},
                )
                label_name = random.choice(spec["labels"])
                IssueLabel.objects.get_or_create(
                    issue=issue,
                    label=labels[label_name],
                    defaults={"project": project, "workspace": workspace},
                )
                if cycles and random.random() < 0.7:
                    CycleIssue.objects.get_or_create(
                        issue=issue,
                        defaults={
                            "cycle": random.choice(cycles),
                            "project": project,
                            "workspace": workspace,
                        },
                    )
                if modules and random.random() < 0.7:
                    ModuleIssue.objects.get_or_create(
                        issue=issue,
                        module=random.choice(modules),
                        defaults={"project": project, "workspace": workspace},
                    )
                made += 1

            self.stdout.write(
                f"project: {project.name} [{project.identifier}] "
                f"{'created' if created else 'exists'} — {made} new work items, "
                f"{len(cycles)} cycles, {len(modules)} modules"
            )

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("KCMS demo data ready."))
        self.stdout.write(f"  workspace : http://localhost:3000/{WORKSPACE_SLUG}/")
        self.stdout.write(f"  sign in   : {DEMO_USERS[0][0]} / {DEMO_PASSWORD}")
