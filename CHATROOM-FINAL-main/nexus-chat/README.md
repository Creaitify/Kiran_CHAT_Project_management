# Nexus Chat

# AI-Powered Real-Time Chat Room — Enhanced Frontend & Functional Prototype Prompt

Build a **modern, premium, real-time collaboration chat application** inspired by the usability of WhatsApp, Slack, and modern AI chat products.

The prototype must support:

1. Shared group chat
2. Private 1-to-1 chat between participants
3. Creating new group discussion rooms by selecting participants
4. Private `@agent` LLM interactions
5. Invite links
6. Group mute/unmute
7. Individual participant mute/unmute
8. Admin controls
9. Modern, polished, client-demo-ready frontend

The **frontend experience is the highest priority**.

---

# 1. Core Layout

Use the attached hand-drawn reference as the base structural idea, but significantly improve the interface.

The application should primarily contain **two main sections**:

### Left: Messaging Workspace

This section contains:

* Conversation navigation
* Active group/private chat
* Messages
* `@agent` interaction
* Message composer

### Right: Context Panel

This section contains:

* Group information
* Group controls
* Invite members
* Participants
* Individual participant controls

For private chats, the right panel should adapt and show the selected participant's information instead of unnecessary group controls.

---

# 2. Conversation Navigation

Inside the left workspace, include a narrow modern **conversation sidebar** similar to WhatsApp or Slack.

It should contain:

### Header

* Current user's avatar
* Search
* Notifications
* New Chat button
* Create Group button

### Conversation Sections

Show:

**Groups**

* Product Team
* Sales Discussion
* Project Alpha

**Direct Messages**

* Rahul
* Priya
* Akash

Each conversation should display:

* Avatar or group avatar
* Conversation name
* Last message preview
* Timestamp
* Unread message count
* Online indicator where applicable
* Muted indicator where applicable

Clicking a conversation should instantly open it in the main chat area.

---

# 3. Shared Group Chat

Users should be able to communicate normally inside shared chat rooms.

Normal messages must be visible to **all members of that specific group**.

Example:

```text
Rahul:
Has the requirement been approved?

Priya:
Yes. We can start the frontend.
```

Messages should include:

* Avatar
* Name
* Message
* Timestamp
* Sent/read indicators where appropriate
* Current-user message styling
* Other-user message styling

Support:

* Text messages
* Emoji
* Reply
* Copy
* Basic message reactions
* Message timestamps

For the prototype, file attachment icons can be included visually even if advanced upload functionality is not implemented.

---

# 4. Private 1-to-1 Chat

Add the ability for users to start a **personal chat with any participant**.

### Interaction

When a user clicks a participant inside the Participants panel, show options:

* Message Privately
* View Profile
* Add to New Group

Selecting **Message Privately** should open a direct one-to-one conversation.

Example:

```text
Rahul ↔ Priya

Rahul:
Can we discuss the pricing separately?

Priya:
Sure.
```

### Privacy Requirement

A private conversation must be visible **only to the two participants**.

Other group members must not:

* See the private conversation
* Receive the messages
* See its history
* See AI responses generated inside it

Private conversations should appear under **Direct Messages** in the conversation sidebar.

---

# 5. Create New Group from Participants

Users should be able to create separate group discussion rooms by selecting participants.

This should work similarly to **Create Group in WhatsApp**.

Add a prominent:

**+ Create Group**

button.

It can be available from:

* Conversation sidebar
* Participants panel
* Group menu

---

## Create Group Flow

### Step 1 — Select Participants

Open a modal or side drawer:

**Create New Group**

Show all available participants with:

* Checkbox
* Avatar
* Name
* Online/offline status

Include search:

`Search participants...`

Example:

```text
☑ Rahul
☑ Priya
☐ Akash
☑ Neha
```

Display selected users as avatar chips at the top.

---

### Step 2 — Group Information

After selecting participants:

Ask for:

* Group name
* Optional group description
* Optional group image/avatar

Example:

```text
Group Name
Sales Strategy Discussion

Description
Internal discussion for Sales Team
```

Primary CTA:

**Create Group**

---

### Step 3 — Create Separate Discussion Room

After creation:

* Create a new independent chat room.
* Add selected participants.
* Make the creator the Admin.
* Open the new group automatically.
* Add the group to the Groups section.
* Allow normal group messaging.
* Allow `@agent`.
* Enable participant management.
* Enable invite links.
* Enable group mute/unmute.

Each group must behave as an independent discussion room.

Messages from one group must never appear inside another group.

---

# 6. Quick Group Creation from Existing Participants

In addition to the main Create Group flow, support a faster interaction.

Inside the Participants panel:

Allow the admin/user to click:

**Select Participants**

Then show selection checkboxes beside participants.

Example:

```text
Participants

☑ Rahul
☑ Priya
☐ Akash
☑ Neha

[ Create Group with Selected ]
```

Clicking the button should open the group-name dialog.

This makes creating a separate discussion room very quick.

---

# 7. LLM Agent Using @agent

One of the most important features is an integrated AI assistant.

Users should call the AI by typing:

```text
@agent
```

Example:

```text
@agent Analyse this requirement and recommend an architecture.
```

The system should:

1. Detect `@agent`.
2. Identify the user who invoked it.
3. Extract the text following `@agent`.
4. Send that request to the LLM.
5. Generate the response.
6. Display the AI response only to the requesting user.

---

# 8. Critical AI Privacy Behaviour

The AI is **not a normal group participant**.

Its responses must remain private.

Example:

```text
Shared Group

Rahul:
Can someone analyse this requirement?

Rahul:
@agent Analyse it.

Private AI response visible only to Rahul:

┌──────────────────────────────────┐
│ ✦ AI Agent                       │
│                                  │
│ Here is my analysis...           │
└──────────────────────────────────┘
```

Priya, Akash, and other participants should still see Rahul's normal shared messages according to room rules, but they must **not see Rahul's AI response**.

---

# 9. Per-User AI Conversations

Every user must have an independent AI session.

Example:

```text
Rahul → @agent
       ↓
Private AI Response A
Only Rahul can see it


Priya → @agent
       ↓
Private AI Response B
Only Priya can see it
```

Rahul cannot see Priya's AI output.

Priya cannot see Rahul's AI output.

This rule applies in:

* Main groups
* Newly created groups
* Direct messages

Even inside a direct message conversation, an AI response should be visible only to the person who invoked it unless they manually share the AI response.

---

# 10. AI Message Design

AI responses should look visually different from human messages.

Use a premium AI card/bubble containing:

* AI icon
* `AI Agent`
* Subtle gradient
* Small label such as `Private to you`
* Response text
* Copy button
* Regenerate option
* Optional Share to Chat action

Example:

```text
✦ AI Agent
Private to you

Based on the discussion, I recommend...

[ Copy ] [ Regenerate ] [ Share to Chat ]
```

### Share to Chat

If the user clicks **Share to Chat**, convert the selected AI response into a normal shared message.

Only then should other participants see it.

The AI must never automatically share its response.

---

# 11. @agent Composer Interaction

The message composer should visually recognise `@agent`.

When the user types:

```text
@
```

show an autocomplete menu:

```text
Mention

✦ @agent
  Ask the private AI assistant

Rahul
Priya
Akash
```

When `@agent` is selected:

* Highlight the mention.
* Show an AI indicator.
* Change the composer subtly.

Example:

```text
┌───────────────────────────────────────────┐
│ ✦ @agent  Ask anything...                │
│                                  Send ↑   │
└───────────────────────────────────────────┘
```

Display:

**“AI response will only be visible to you.”**

---

# 12. Chat Header

The active conversation header should show:

### Group

* Group avatar
* Group name
* Number of members
* Online members
* Search
* More menu

Example:

```text
Product Strategy
8 members • 4 online
```

### Private Chat

Show:

```text
Rahul Sharma
Online
```

Include actions such as:

* Search conversation
* Participant/profile information
* More menu

---

# 13. Right Panel — Group Controls

For group conversations, show:

### Group Information

* Group avatar
* Group name
* Description
* Number of members
* Created by
* Creation date

---

## Group Controls

### Mute Entire Group

Only the group admin can control this.

Use a premium toggle:

```text
Group Messaging

Mute Group                 [ OFF ]
```

When enabled:

```text
Mute Group                 [ ON ]
```

---

# 14. Group Muted Behaviour

When the entire group is muted:

Participants can:

* Open the room
* Read message history
* See new admin messages if permitted
* Access existing content

Participants cannot:

* Send normal group messages

Replace the composer with:

```text
🔒 Group messaging is currently disabled by the admin.
```

The admin must still be able to:

* Unmute group
* Manage participants
* Manage invite links
* Access administrative actions

---

# 15. Individual Participant Controls

Display all participants in the right panel.

Example:

```text
Participants                                      8

● Rahul Sharma                         Admin
● Priya Kapoor                         [ Mute ]
○ Akash Mehta                          [ Unmute ]
● Neha Jain                            [ Mute ]
```

Each participant should contain:

* Avatar
* Name
* Admin/member badge
* Online status
* More menu
* Mute/unmute control

---

# 16. Individual Muting

Admin can mute individual users.

Muted participants:

* Can read messages
* Can see chat history
* Cannot send normal group messages
* Do not affect other participants
* Can still use private `@agent`

When muted, their composer should display:

```text
🔇 You have been muted by the group administrator.
```

The application should distinguish between:

* Group muted
* User individually muted

---

# 17. Invite Members

Provide an Invite Members section.

Example:

```text
Invite Members

https://app.example.com/join/ABC123

[ Copy Link ]

+ Generate New Link
```

Admin should be able to:

* Generate invite link
* Copy invite link
* Regenerate link
* Disable/revoke link

---

# 18. Invite Link Flow

When someone opens an invite URL:

Show:

```text
You've been invited to

Product Strategy

8 members

[ Join Group ]
```

After joining:

* Add participant to room.
* Give access according to group permissions.
* Allow reading available message history.
* Allow messaging if not muted.
* Allow `@agent`.
* Add group to their conversation sidebar.

---

# 19. Right Panel for Private Chats

When a direct message is active, replace group administration controls with:

### Participant Profile

* Avatar
* Name
* Online status
* Role
* Mutual groups

Actions:

* Search conversation
* Add to Group
* Create Group with This User
* Mute notifications
* Clear local chat prototype state if required

Do not display irrelevant group mute controls inside one-to-one conversations.

---

# 20. Add Direct Chat Participant into New Group

From a private conversation, include:

**Create Group with [Name]**

Example:

Rahul is privately chatting with Priya.

Rahul clicks:

**Create Group with Priya**

Then show participant selector:

```text
Selected

✓ Rahul
✓ Priya

Add more participants

□ Akash
□ Neha
□ Riya
```

Then:

**Next → Name Group → Create**

This should make group creation feel extremely intuitive.

---

# 21. Conversation Types

The frontend should visually distinguish between:

### Group Chat

Use stacked avatars or a group icon.

### Direct Message

Use individual avatar.

### AI Response

Use AI/star/spark icon with:

**Private to you**

Never show the AI as a permanent member inside the Participants list.

---

# 22. Search

Add a global conversation search.

Users should be able to search:

* Groups
* Participants
* Direct messages

Inside an active conversation, provide message search.

---

# 23. Notifications

Show lightweight real-time notifications.

Examples:

```text
Priya sent a new message
```

```text
You were added to “Sales Strategy”
```

```text
Rahul created “Project Review”
```

```text
Group messaging has been muted by Admin
```

```text
You have been muted by Admin
```

Use modern toast notifications.

---

# 24. Frontend Visual Direction

The application must feel:

* Modern
* Premium
* Sophisticated
* AI-powered
* Enterprise-ready
* Client-demo ready

Avoid a basic CRUD/dashboard appearance.

---

# 25. Visual Style

Use a **dark sophisticated collaboration interface**.

Suggested direction:

* Deep charcoal/navy background
* Slight blue, violet, or cyan accent
* Glassmorphism cards
* Semi-transparent surfaces
* Subtle gradients
* Soft ambient glow
* Rounded 14–20px cards
* Smooth shadows
* Thin borders
* Modern typography
* Premium avatars
* High-quality icons
* Generous spacing
* Clear hierarchy

Keep text highly readable.

---

# 26. 3D / Depth Elements

Use restrained 3D visual effects.

For example:

* Layered floating chat cards
* Slight elevated AI response card
* Soft depth behind active conversations
* Animated glowing AI icon
* Subtle gradient orb in background
* Floating participant avatar stack
* Depth effect on active group card

Do not make the interface overly futuristic.

The application must remain practical and professional.

---

# 27. Microinteractions

Include smooth interactions such as:

* Hover states
* Button press animations
* Toggle transitions
* Message appearing animation
* Typing indicator
* AI thinking animation
* Drawer animation
* Modal transitions
* Participant-selection animation
* Online status pulse
* Copy-link confirmation
* Group-created success animation

---

# 28. AI Loading State

When waiting for an LLM response, show:

```text
✦ AI Agent
Thinking...
```

Use a subtle animated effect such as three dots or a soft glowing AI icon.

Do not block normal conversation while the AI is generating.

---

# 29. Responsive Behaviour

Desktop should be the primary client-demo experience.

Desktop structure:

```text
┌───────────────────────────────────────────────────────────────────┐
│                           TOP BAR                                 │
├───────────────┬────────────────────────────────┬──────────────────┤
│ Conversations │                                │                  │
│               │        Active Chat             │  Group / User    │
│ Groups        │                                │  Information     │
│ Direct        │                                │                  │
│ Messages      │                                │  Controls        │
│               │                                │                  │
│ + New Chat    │                                │  Participants    │
│ + New Group   │                                │                  │
│               ├────────────────────────────────┤                  │
│               │ Message / @agent Composer      │                  │
└───────────────┴────────────────────────────────┴──────────────────┘
```

Conceptually, the application still contains:

**Primary section 1:** Messaging workspace
**Primary section 2:** Context/control panel

The conversation rail belongs inside the messaging workspace.

---

# 30. Mobile Behaviour

For smaller screens:

* Show conversation list first.
* Open selected conversation full screen.
* Open group information as a slide-over drawer.
* Open participant list as a drawer.
* Keep composer fixed at bottom.
* Keep `@agent` easy to access.

---

# 31. Prototype State

Do not build unnecessary production-level persistence yet.

Use lightweight/mock/local application state for:

* Users
* Messages
* Groups
* Direct messages
* Selected participants
* Admin status
* Mute state
* Invite links
* AI responses

Structure the code cleanly so that APIs, WebSockets, authentication, and a database can later replace mock state without rebuilding the UI.

---

# 32. Suggested Logical Entities

Keep frontend state conceptually separated into:

```text
Users
Rooms
Room Members
Messages
Private AI Messages
Invite Links
Permissions
```

A room can have a type:

```text
group
direct
```

---

# 33. AI Privacy Architecture

Treat normal group messages and AI responses as different data types.

Conceptually:

```text
SharedMessage
- roomId
- senderId
- content
- timestamp
```

AI message:

```text
PrivateAIMessage
- roomId
- ownerUserId
- prompt
- response
- timestamp
```

The critical difference is:

```text
ownerUserId
```

Only the matching user should receive/render that AI response.

Never broadcast private AI responses through the normal group messaging channel.

---

# 34. Direct Message Privacy

Direct messages should use a room accessible only to its participants.

Conceptually:

```text
DirectRoom
- roomId
- participantIds[]
```

Only users whose IDs exist inside `participantIds` can access that conversation.

---

# 35. New Group Architecture

Creating a new group should conceptually create:

```text
GroupRoom
- roomId
- name
- description
- createdBy
- adminIds[]
- participantIds[]
- groupMuted
- inviteLink
```

Each group must maintain independent:

* Messages
* Participants
* Admins
* Mute state
* Invite links
* AI interactions

---

# 36. Demo Data

Populate the prototype with realistic sample data so the frontend never looks empty.

For example:

### Groups

* Product Strategy
* Sales Team
* Client Discussion
* Project Alpha

### Participants

* Rahul Sharma — Admin
* Priya Kapoor
* Akash Mehta
* Neha Jain
* Riya Desai
* Arjun Shah

Show a mix of:

* Online users
* Offline users
* Muted participant
* Admin
* Unread conversations

---

# 37. Important Demo Scenarios

The prototype should allow the client to immediately demonstrate these scenarios:

### Scenario 1

Rahul sends:

```text
Hello everyone.
```

Everyone in Product Strategy sees it.

### Scenario 2

Rahul sends:

```text
@agent Summarise our current discussion.
```

Only Rahul receives the AI response.

### Scenario 3

Priya independently uses:

```text
@agent Suggest the next steps.
```

Only Priya sees her AI response.

### Scenario 4

Rahul clicks Priya → **Message Privately**.

A private Rahul ↔ Priya conversation opens.

### Scenario 5

Rahul selects:

* Priya
* Akash
* Neha

and clicks:

**Create Group**

A new independent discussion room is created.

### Scenario 6

Admin mutes Akash.

Akash can read the group but cannot send normal messages.

### Scenario 7

Admin mutes the entire group.

All non-admin participant composers become disabled.

### Scenario 8

Admin generates an invite link.

A new participant opens the link and joins the group.

---

# 38. Implementation Priority

Build in this order:

### Priority 1 — Premium Frontend

Build:

* Conversation sidebar
* Group chat
* Direct messages
* Right-side information panel
* Participant list
* Create Group flow
* Modals
* Responsive design
* Animations
* High-quality visual treatment

### Priority 2 — Private @agent

Implement:

1. Detect `@agent`
2. Extract request
3. Call LLM
4. Return response
5. Associate response with invoking user
6. Render only for that user
7. Keep it separate from shared messages

### Priority 3 — Direct Messaging

Implement private one-to-one conversations between participants.

### Priority 4 — Group Creation

Implement:

* Participant multi-selection
* Group name
* Group creation
* Separate room
* Independent messages
* Creator as admin

### Priority 5 — Invite Links

Implement:

* Generate
* Copy
* Join
* Regenerate/revoke

### Priority 6 — Permissions

Implement:

* Group mute/unmute
* Individual mute/unmute
* Disabled composer states
* Admin-only controls

---

# 39. Critical Functional Rules

The following rules must never be violated:

**Rule 1:** Normal group messages are visible to all members of that group.

**Rule 2:** Direct messages are visible only to the users participating in that direct conversation.

**Rule 3:** `@agent` responses are visible only to the user who invoked the agent.

**Rule 4:** AI responses must never automatically become shared messages.

**Rule 5:** Newly created groups have completely separate conversations.

**Rule 6:** Selecting participants and creating a group must not remove them from existing groups.

**Rule 7:** A user may belong to multiple groups simultaneously.

**Rule 8:** Only authorised admins can control group-wide and participant mute settings.

**Rule 9:** A muted participant can continue reading messages.

**Rule 10:** Unless AI access is disabled separately, a muted participant may still use private `@agent`.

---

# Final Objective

Create a visually impressive **AI-powered collaboration platform** where users can seamlessly move between:

**Group Chat → Private Chat → New Group Discussion → Private AI Assistance**

The experience should feel familiar enough for a WhatsApp user to understand immediately, while looking significantly more premium, modern, enterprise-ready, and AI-native.

The strongest demo differentiator should be the combination of:

**Shared Human Collaboration + Private Personal AI Assistance inside the same conversation context.**

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/af243b21-e036-4cfe-bb9f-debad8b6ceb9).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
