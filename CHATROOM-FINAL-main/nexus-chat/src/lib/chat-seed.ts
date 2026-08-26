/** Seed data for the local workspace. Kept apart from the store for readability. */

import type { PrivateAIMessage, Room, SharedMessage, User, UserGroup } from "./chat-types";

const now = Date.now();
const min = 60_000;

export const SEED_USERS: User[] = [
  {
    id: "u1",
    name: "Rahul Sharma",
    role: "Product Lead",
    online: true,
    color: "#4cc9f0",
    timeZone: "Asia/Kolkata",
  },
  {
    id: "u2",
    name: "Priya Kapoor",
    role: "Frontend Engineer",
    online: true,
    color: "#b388ff",
    timeZone: "Asia/Kolkata",
  },
  {
    id: "u3",
    name: "Akash Mehta",
    role: "Backend Engineer",
    online: false,
    color: "#ffb703",
    timeZone: "Europe/Berlin",
  },
  {
    id: "u4",
    name: "Neha Jain",
    role: "Designer",
    online: true,
    color: "#4ade80",
    timeZone: "Asia/Kolkata",
  },
  {
    id: "u5",
    name: "Riya Desai",
    role: "QA Analyst",
    online: false,
    color: "#f472b6",
    timeZone: "America/New_York",
  },
  {
    id: "u6",
    name: "Arjun Shah",
    role: "Sales Manager",
    online: true,
    color: "#fb7185",
    timeZone: "Asia/Kolkata",
  },
];

export const SEED_GROUPS: UserGroup[] = [
  { id: "g-eng", handle: "engineering", name: "Engineering", memberIds: ["u2", "u3"] },
  { id: "g-design", handle: "design", name: "Design", memberIds: ["u4"] },
  { id: "g-leads", handle: "leads", name: "Team leads", memberIds: ["u1", "u6"] },
];

export const SEED_ROOMS: Room[] = [
  {
    id: "r1",
    type: "group",
    name: "Product Strategy",
    topic: "Q3 roadmap lock-in",
    description: "Roadmap, requirements and release planning for Q3.",
    createdBy: "u1",
    createdAt: now - 86400000 * 21,
    adminIds: ["u1"],
    participantIds: ["u1", "u2", "u3", "u4", "u5", "u6"],
    groupMuted: false,
    mutedUserIds: ["u3"],
    invite: {
      code: "ABC123",
      createdAt: now - 86400000 * 21,
      expiresAt: now + 86400000 * 7,
      maxUses: 25,
      uses: 3,
    },
    color: "#4cc9f0",
  },
  {
    id: "r2",
    type: "group",
    name: "Sales Discussion",
    topic: "Pipeline review every Thursday",
    description: "Pipeline reviews and pricing conversations.",
    createdBy: "u6",
    createdAt: now - 86400000 * 12,
    adminIds: ["u6", "u1"],
    participantIds: ["u1", "u2", "u6", "u5"],
    groupMuted: false,
    mutedUserIds: [],
    invite: {
      code: "SLS900",
      createdAt: now - 86400000 * 12,
      expiresAt: null,
      maxUses: null,
      uses: 1,
    },
    color: "#b388ff",
  },
  {
    id: "r3",
    type: "group",
    name: "Project Alpha",
    topic: "Kickoff Monday",
    description: "Delivery workspace for the Alpha client engagement.",
    createdBy: "u1",
    createdAt: now - 86400000 * 5,
    adminIds: ["u1"],
    participantIds: ["u1", "u3", "u4"],
    groupMuted: false,
    mutedUserIds: [],
    invite: {
      code: "ALP447",
      createdAt: now - 86400000 * 5,
      expiresAt: now - 86400000,
      maxUses: 10,
      uses: 2,
    },
    color: "#4ade80",
  },
  {
    id: "gd1",
    type: "groupdm",
    createdAt: now - 86400000 * 4,
    adminIds: [],
    participantIds: ["u1", "u2", "u4"],
    mutedUserIds: [],
    color: "#f59e0b",
  },
  {
    id: "d1",
    type: "direct",
    createdAt: now - 86400000 * 2,
    adminIds: [],
    participantIds: ["u1", "u2"],
    mutedUserIds: [],
  },
  {
    id: "d2",
    type: "direct",
    createdAt: now - 86400000,
    adminIds: [],
    participantIds: ["u1", "u4"],
    mutedUserIds: [],
  },
  {
    id: "d3",
    type: "direct",
    createdAt: now - 86400000 * 3,
    adminIds: [],
    participantIds: ["u1", "u3"],
    mutedUserIds: [],
  },
];

interface SeedMessageOptions {
  threadRootId?: string;
  pinnedBy?: string;
  editedAt?: number;
  reactions?: Record<string, string[]>;
}

function m(
  roomId: string,
  senderId: string,
  content: string,
  minsAgo: number,
  options: SeedMessageOptions = {},
): SharedMessage {
  const id = `${roomId}-${senderId}-${minsAgo}`;
  return {
    id,
    clientId: `seed-${id}`,
    roomId,
    senderId,
    content,
    timestamp: now - minsAgo * min,
    reactions: options.reactions ?? {},
    delivery: "read",
    ...(options.threadRootId ? { threadRootId: options.threadRootId } : {}),
    ...(options.pinnedBy ? { pinnedBy: options.pinnedBy, pinnedAt: now - minsAgo * min } : {}),
    ...(options.editedAt ? { editedAt: now - options.editedAt * min } : {}),
  };
}

export const SEED_MESSAGES: SharedMessage[] = [
  m("r1", "u1", "Morning everyone — sharing the updated requirement doc shortly.", 240),
  m("r1", "u2", "Has the requirement been approved by the client?", 180),
  m("r1", "u1", "Yes, signed off yesterday evening.", 172, { reactions: { "🎉": ["u2", "u4"] } }),
  m(
    "r1",
    "u1",
    "**Release checklist** for Q3 — please read before Friday:\n\n1. Requirements signed off\n2. Design tokens frozen\n3. Regression suite green\n\nDetails: https://nexus.example.com/releases/q3",
    170,
    { pinnedBy: "u1" },
  ),
  m("r1", "u2", "Perfect. We can start the frontend then.", 165),
  m(
    "r1",
    "u2",
    "Here is the token helper we discussed:\n\n```ts\nexport function token(name: string) {\n  return `var(--${name})`;\n}\n```",
    160,
  ),
  m("r1", "u4", "I'll push the revised design tokens today 🎨", 90),
  m("r1", "u4", "Started on the spacing scale first.", 88, { threadRootId: "r1-u4-90" }),
  m("r1", "u2", "Nice — does that change the button heights?", 86, { threadRootId: "r1-u4-90" }),
  m("r1", "u4", "Only the small variant, by 2px.", 84, { threadRootId: "r1-u4-90" }),
  m("r1", "u5", "QA will prepare regression cases in parallel.", 42),
  m("r1", "u1", "<!engineering> can one of you own the migration script?", 20),

  m("r2", "u6", "Q3 pipeline looks healthy — 14 qualified leads.", 300),
  m("r2", "u1", "Can we get the pricing sheet before Thursday?", 120),
  m("r2", "u6", "Sending it across tonight.", 30),

  m("r3", "u1", "Alpha kickoff is confirmed for Monday.", 400),
  m("r3", "u3", "Infra is provisioned, staging is up.", 60),

  m("gd1", "u2", "Pulling the three of us into one place for the launch page.", 300),
  m("gd1", "u4", "Works for me — I'll drop the hero mock here.", 280),
  m("gd1", "u1", "Great. <!here> shout if Friday slips.", 120),

  m("d1", "u1", "Can we discuss the pricing separately?", 220),
  m("d1", "u2", "Sure — I'm free after 4.", 210),
  m("d2", "u4", "Sent you the new avatar set.", 500),
  m("d3", "u3", "I'm muted in Product Strategy, can you raise this for me?", 700),
];

export const SEED_AI: PrivateAIMessage[] = [];
