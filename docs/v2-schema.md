> ## Documentation Index
> Fetch the complete documentation index at: https://agentclientprotocol.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Schema

> Schema definitions for the Agent Client Protocol

> [!NOTE]
>
> This schema file is generated in this repository at
> [`schema/v2/schema.json`](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/schema/v2/schema.json).
> GitHub releases for this schema are not published yet.

## Agent

Defines the interface that all ACP-compliant agents must implement.

Agents are programs that use generative AI to autonomously modify code. They handle
requests from clients and execute tasks using language models and tools.

### auth/login

Authenticates the client using the specified authentication method.

Agents MUST support this method when their `initialize` response advertised
at least one valid authentication method. Clients MUST call this method only
with a method whose type defines a protocol-driven login flow, and MUST NOT
call it when `authMethods` was omitted or empty.

Called when the agent requires authentication before allowing session creation.
The client provides the authentication method ID that was advertised during initialization.

After successful authentication, the client can proceed to create sessions with
`new_session` without receiving an `auth_required` error.

See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/v2/initialization.md)

#### LoginAuthRequest

Request parameters for the `auth/login` method.

Specifies which authentication method to use.

Agents MUST support this method when their `initialize` response advertised
at least one valid authentication method. Clients MUST NOT call this method
when `authMethods` was omitted or empty.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**methodId** *required*

The ID of the authentication method to use.
Must be one of the methods advertised in the initialize response.

#### LoginAuthResponse

Response to the `auth/login` method.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

### auth/logout

Logs out of the current authenticated state.

Agents MUST support this method when their `initialize` response advertised
at least one valid authentication method. Clients MUST NOT call this method
when `authMethods` was omitted or empty.

After a successful logout, authentication-gated requests require the
client to complete an advertised authentication flow again. There is no
guarantee about the behavior of already running sessions.

#### LogoutAuthRequest

Request parameters for the `auth/logout` method.

Terminates the current authenticated session.

Agents MUST support this method when their `initialize` response advertised
at least one valid authentication method. Clients MUST NOT call this method
when `authMethods` was omitted or empty.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

#### LogoutAuthResponse

Response to the `auth/logout` method.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

### initialize

Establishes the connection with a client and negotiates protocol capabilities.

This method is called once at the beginning of the connection to:

* Negotiate the protocol version to use
* Exchange capability information between client and agent
* Determine available authentication methods

The agent should respond with its supported protocol version and capabilities.

See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/v2/initialization.md)

#### InitializeRequest

Request parameters for the initialize method.

Sent by the client to establish connection and negotiate capabilities.

See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/v2/initialization.md)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**capabilities**

Capabilities supported by the client.

* Default: `{}`

**info** *required*

Information about the implementation sending this initialize request.

**protocolVersion** *required*

The latest protocol version supported by the client.

#### InitializeResponse

Response to the `initialize` method.

Contains the negotiated protocol version and agent capabilities.

See protocol docs: [Initialization](https://agentclientprotocol.com/protocol/v2/initialization.md)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**authMethods**

Authentication methods supported by the agent.

Optional. Omitted or empty means the agent does not advertise the
authentication method surface. Supplying one or more valid methods means
the agent MUST support both `auth/login` and `auth/logout`.

**capabilities**

Capabilities supported by the agent.

* Default: `{}`

**info** *required*

Information about the implementation sending this initialize response.

**protocolVersion** *required*

The highest protocol version supported by the agent that is at or below
the version requested by the client. If no such version exists,
initialization fails with error code -32022.

The client must check that it supports this version and should disconnect
if it does not.

### session/cancel

Cancels ongoing operations for a session.

This is a notification sent by the client to cancel active work in a
session.

Upon receiving this notification, the Agent SHOULD stop all language model
requests and all tool call invocations as soon as possible.

After all ongoing operations have been successfully aborted and pending
updates have been sent, the Agent MUST send an idle `state_update` session
update with the `cancelled` stop reason if cancellation ended active
foreground work. No additional completion update is required if no
foreground work was active.

After cancellation completes, the Agent SHOULD ignore late answers rather
than use them to resume the cancelled work.

Agents MUST catch errors caused by aborting cancelled work and report the
`cancelled` stop reason, not `error`.

The Agent MAY send content or tool call updates after receiving
`session/cancel`, but MUST send them before the idle `state_update` that
reports cancellation.

See protocol docs: [Cancellation](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#cancellation)

#### CancelSessionNotification

Notification to cancel ongoing operations for a session.

See protocol docs: [Cancellation](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#cancellation)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**sessionId** *required*

The ID of the session to cancel operations for.

### session/close

Closes an active session and frees up any resources associated with it.

The agent must cancel any ongoing work (as if `session/cancel` was called)
and then free up any resources associated with the session.

#### CloseSessionRequest

Request parameters for closing an active session.

The agent **must** cancel any ongoing work related to the session (treat it
as if `session/cancel` was called) and then free up any resources associated
with the session.

When closing cancels active foreground work, the Agent MUST send the final
updates for that work and the idle `state_update` with `stopReason: "cancelled"`
before responding successfully to `session/close`. Closing an idle session
does not itself require another idle update.

Closing may also cancel pending `session/prompt` requests, including queued
prompts. If closing prevents a prompt's user message from being inserted, the
Agent MUST answer that request with `-32800` (Request Cancelled). If the message
has already been inserted, the Agent MUST respond successfully with its
`messageId`. Prompt responses need not precede the close response.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**sessionId** *required*

The ID of the session to close.

#### CloseSessionResponse

Response from closing a session.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

### session/delete

Deletes an existing session from `session/list`.

This method is only available if the agent advertises the `session.delete` capability.

#### DeleteSessionRequest

Request parameters for deleting an existing session from `session/list`.

Only available if the Agent supports the `session.delete` capability.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**sessionId** *required*

The ID of the session to delete.

#### DeleteSessionResponse

Response from deleting a session.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

### session/list

Lists existing sessions known to the agent.

The agent should return metadata about sessions with optional filtering and pagination support.

#### ListSessionsRequest

Request parameters for listing existing sessions.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**cursor**

Opaque cursor token from a previous response's nextCursor field for cursor-based pagination

**cwd**

Filter sessions by working directory. Must be an absolute path.

#### ListSessionsResponse

Response from listing sessions.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**nextCursor**

Opaque cursor token. If present, pass this in the next request's cursor parameter
to fetch the next page. If absent, there are no more results.

**sessions** *required*

Array of session information objects.

### session/new

Creates a new conversation session with the agent.

Sessions represent independent conversation contexts with their own history and state.

The agent should:

* Create a new session context
* Connect to any specified MCP servers
* Return a unique session ID for future requests

May return an `auth_required` error if the agent requires authentication.

See protocol docs: [Session Setup](https://agentclientprotocol.com/protocol/v2/session-setup.md)

#### NewSessionRequest

Request parameters for creating a new session.

See protocol docs: [Creating a Session](https://agentclientprotocol.com/protocol/v2/session-setup.md#creating-a-session)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**additionalDirectories**

Additional workspace roots for this session. Each path must be absolute.

These expand the session's workspace scope without changing `cwd`, which
remains the base for relative paths. When omitted or empty, no
additional roots are activated for the new session.

**cwd** *required*

The working directory for this session. Must be an absolute path.

**mcpServers**

List of MCP (Model Context Protocol) servers the agent should connect to.

#### NewSessionResponse

Response from creating a new session.

New sessions default to `idle` until a state update reports otherwise.
Updates may arrive before or after this response. Clients MUST NOT overwrite
an already-reported state when the response arrives.

See protocol docs: [Creating a Session](https://agentclientprotocol.com/protocol/v2/session-setup.md#creating-a-session)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**availableCommands**

Initial commands the agent can execute in this session.

Optional. Omitted or empty means no initial commands are advertised.
Senders MUST use an array, not `null`; receivers treat `null` like omission.
Later `available_commands_update` notifications replace this list.

**configOptions**

Initial session configuration options.

**sessionId** *required*

Unique identifier for the created session.

Used in all subsequent requests for this conversation.

### session/prompt

Processes a user prompt within a session.

Acceptance means adding a logical user message with an ID and a position
relative to other messages in the ACP conversation, not receipt or queueing.
The Agent MUST return the inserted message's ID without waiting for
processing to finish.

The Agent reports the user message with the same ID through `session/update`;
this notification may arrive before or after the response, but neither may
precede insertion. Processing state, output, tool calls, and completion are
also reported through session updates.

An error response means the user message was not inserted. Once it is
inserted, the Agent MUST NOT answer with an error, even if the work fails
before the response is sent; it ends that work with the `error` stop reason.

A rejected submission produces no user-message updates. Foreground state
follows its normal lifecycle independently of the request outcome:
`running` may precede insertion, and rejection alone does not imply `idle`.

See protocol docs: [Prompt Lifecycle](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md)

#### PromptRequest

Request parameters for sending a user prompt to the agent.

Contains the user's message and any additional context.

See protocol docs: [User Message](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#1-user-message)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**prompt** *required*

The blocks of content that compose the user's message.

As a baseline, the Agent MUST support `ContentBlock::Text` and `ContentBlock::ResourceLink`,
while other variants are optionally enabled via `PromptCapabilities`.

The Client MUST adapt its interface according to `PromptCapabilities`.

The client MAY include referenced pieces of context as either
`ContentBlock::Resource` or `ContentBlock::ResourceLink`.

When available, `ContentBlock::Resource` is preferred
as it avoids extra round-trips and allows the message to include
pieces of context from sources the agent may not have access to.

**sessionId** *required*

The ID of the session to send this user message to

#### PromptResponse

Response acknowledging that a user prompt was inserted into the ACP conversation.

This response does not indicate that the prompt was merely received or queued, nor that the
agent has finished processing it.
Processing and completion are reported through `state_update` session updates.

Insertion is the logical addition of a user message with a message ID and a position
relative to other messages in the ACP conversation.

See protocol docs: [Prompt Accepted](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#2-prompt-accepted)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**messageId** *required*

Identifies the user message inserted into the ACP conversation.

Required and non-null. Omission and explicit `null` are both invalid.

The corresponding user-message session update carries this same identifier and may arrive
before or after this response. Agents must echo the message during the live session, but are
not required to retain it. If retained and replayed, the message keeps this identifier.

### session/resume

Resumes an existing session.

The agent should resume the session context, allowing the conversation
to continue. If `replayFrom` is set, the agent should replay
retained conversation history before responding.

#### ResumeSessionRequest

Request parameters for resuming an existing session.

Resumes an existing session and optionally replays retained conversation
history according to `replayFrom`.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**additionalDirectories**

Additional workspace roots to activate for this session. Each path must be absolute.

When omitted or empty, no additional roots are activated. When non-empty,
this is the complete resulting additional-root list for the resumed
session. It may differ from any previously used or reported list as long as
the request `cwd` matches the session's `cwd`.

**cwd** *required*

The working directory for this session. Must be an absolute path.

**mcpServers**

List of MCP servers to connect to for this session.

**replayFrom**

Inclusive cursor describing where conversation replay should begin.

Optional. Omitted or `null` both mean the Agent should resume without
replaying previous conversation history. Replay cursors are inclusive:
replay includes the position identified by the cursor. Supplying
`\{ "type": "start" \}` means the Agent should replay all retained
conversation history before responding.

Agents MUST reject unsupported cursor types or malformed cursor values
with `-32602` (Invalid params), rather than substituting another cursor
or resuming without replay.

**sessionId** *required*

The ID of the session to resume.

#### ResumeSessionResponse

Response from resuming an existing session.

The agent MUST send a current `state_update` after any requested history
replay and before this response, even without replay. The update reports
foreground state after resuming. The response alone does not imply `idle`.

See protocol docs: [Current-State Synchronization](https://agentclientprotocol.com/protocol/v2/session-setup.md#current-state-synchronization)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**availableCommands**

Initial commands the agent can execute in this session.

Optional. Omitted or empty means no initial commands are advertised.
Senders MUST use an array, not `null`; receivers treat `null` like omission.
Later `available_commands_update` notifications replace this list.

**configOptions**

Initial session configuration options.

### session/set\_config\_option

Sets the current value for a session configuration option.

#### SetSessionConfigOptionRequest

Request parameters for setting a session configuration option.

**Type:** Union

**Shared properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**configId** *required*

The ID of the configuration option to set.

**sessionId** *required*

The ID of the session to set the configuration option for.

**Variants:**

**id** `object`

A `SessionConfigValueId` string value (`type: "id"`).

**Properties**

**type** `string` *required*

The discriminator value. Must be `"id"`.

**value** *required*

The value ID.

**boolean** `object`

A boolean value (`type: "boolean"`).

**Properties**

**type** `string` *required*

The discriminator value. Must be `"boolean"`.

**value** `boolean` *required*

The boolean value.

**other** `object`

Custom or future session configuration option value payload.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**Properties**

**type** `string` *required*

Custom or future session configuration option value type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**value** `any` *required*

Raw value payload for the custom or future value type.

#### SetSessionConfigOptionResponse

Response to `session/set_config_option` method.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**configOptions** *required*

The full set of configuration options and their current values.

## Client

Defines the interface that ACP-compliant clients must implement.

Clients are typically code editors (IDEs, text editors) that provide the interface
between users and AI agents. They manage the environment, handle user interactions,
and control access to resources.

### elicitation/complete

Notification that a URL-based elicitation has completed.

See protocol docs: [Elicitation](https://agentclientprotocol.com/protocol/v2/elicitation.md#url-completion)

#### CompleteElicitationNotification

Notification sent by the agent when a URL-based elicitation is complete.

This notification is not a foreground state update.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**elicitationId** *required*

The ID of the elicitation that completed.

### elicitation/create

Requests structured user input via a form or URL.

See protocol docs: [Elicitation](https://agentclientprotocol.com/protocol/v2/elicitation.md)

#### CreateElicitationRequest

Request from the agent to elicit structured user input.

The agent sends this to the client to request information from the user,
either via a form or by directing them to a URL.
Elicitations are tied to a session (optionally a tool call) or a request.

A session-scoped request follows the aggregate foreground-state contract:
agents SHOULD report `requires_action` when the whole foreground workflow is
blocked on user action. Once reported, they MUST report `running` when progress
resumes, or `idle` if work ends without resuming. Independent background requests
and request-scoped elicitations do not themselves change session state.
Accepting a URL does not mean the external interaction completed.

Agents SHOULD cancel pending elicitations no longer needed by cancelled work.
The request's scope alone does not establish that dependency.

See protocol docs: [Elicitation](https://agentclientprotocol.com/protocol/v2/elicitation.md)

**Type:** Union

**Shared properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**message** `string` *required*

A human-readable message describing what input is needed.

**Variants:**

**form** `object`

Form-based elicitation where the client renders a form from the provided schema.

**Properties**

**mode** `string` *required*

The discriminator value. Must be `"form"`.

**requestedSchema** *required*

A JSON Schema describing the form fields to present to the user.

**Alternatives (`anyOf`):**

**Session**

Tied to a session, optionally to a specific tool call within that session.

**Properties**

**sessionId** *required*

The session this elicitation is tied to.

**toolCallId**

Optional tool call within the session.

Optional. Omitted and `null` are equivalent and mean the elicitation is scoped to the
session without a specific tool call.

**Request**

Tied to a specific JSON-RPC request outside of a session
(e.g., during auth/configuration phases before any session is started).

**Properties**

**requestId** *required*

The request this elicitation is tied to.

**url** `object`

URL-based elicitation where the client directs the user to a URL.

**Properties**

**elicitationId** *required*

The unique identifier for this elicitation.

**mode** `string` *required*

The discriminator value. Must be `"url"`.

**url** `string` *required*

The URL to direct the user to.

* Format: `uri`

**Alternatives (`anyOf`):**

**Session**

Tied to a session, optionally to a specific tool call within that session.

**Properties**

**sessionId** *required*

The session this elicitation is tied to.

**toolCallId**

Optional tool call within the session.

Optional. Omitted and `null` are equivalent and mean the elicitation is scoped to the
session without a specific tool call.

**Request**

Tied to a specific JSON-RPC request outside of a session
(e.g., during auth/configuration phases before any session is started).

**Properties**

**requestId** *required*

The request this elicitation is tied to.

**other** `object`

Custom or future elicitation mode.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Clients that do not understand this mode should preserve the raw payload
when storing, replaying, proxying, or forwarding elicitation requests.
They MUST NOT render it as a known elicitation mode.

**Properties**

**mode** `string` *required*

Custom or future elicitation mode.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**Alternatives (`anyOf`):**

**Session**

Tied to a session, optionally to a specific tool call within that session.

**Properties**

**sessionId** *required*

The session this elicitation is tied to.

**toolCallId**

Optional tool call within the session.

Optional. Omitted and `null` are equivalent and mean the elicitation is scoped to the
session without a specific tool call.

**Request**

Tied to a specific JSON-RPC request outside of a session
(e.g., during auth/configuration phases before any session is started).

**Properties**

**requestId** *required*

The request this elicitation is tied to.

#### CreateElicitationResponse

Response from the client to an elicitation request.

**Type:** Union

**Shared properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**Variants:**

**accept** `object`

The user accepted and provided content.

**Properties**

**action** `string` *required*

The discriminator value. Must be `"accept"`.

**content** `object | null`

The user-provided content, if any, as an object matching the requested schema.

**decline** `object`

The user declined the elicitation.

**Properties**

**action** `string` *required*

The discriminator value. Must be `"decline"`.

**cancel** `object`

The elicitation was cancelled.

**Properties**

**action** `string` *required*

The discriminator value. Must be `"cancel"`.

**other** `object`

Custom or future elicitation action.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Agents that do not understand this action should preserve the raw
payload when storing, replaying, proxying, or forwarding elicitation
responses. They MUST NOT treat it as a known elicitation action.

**Properties**

**action** `string` *required*

Custom or future elicitation action.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

### session/request\_permission

Requests permission from the user for an operation.

Called by the agent when it needs user authorization before executing
a potentially sensitive operation. The client should present the options
to the user and return their decision.

If the client cancels active session work via `session/cancel`, it MUST
respond to this request with `RequestPermissionOutcome::Cancelled`.

See protocol docs: [Requesting Permission](https://agentclientprotocol.com/protocol/v2/tool-calls.md#requesting-permission)

#### RequestPermissionRequest

Request for user permission to proceed with an operation.

Sent when the agent needs authorization before performing a sensitive operation.

See protocol docs: [Requesting Permission](https://agentclientprotocol.com/protocol/v2/tool-calls.md#requesting-permission)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**description** `string | null`

Optional human-readable explanation of why permission is needed.

This text is specific to the permission prompt and does not update any
subject's displayed content. Omitted or `null` both mean no separate
permission description was provided.

**options** *required*

Available permission options for the user to choose from.
Must contain at least one option.

**sessionId** *required*

The session ID for this request.

**subject**

Optional structured context about the operation requiring permission.

Omitted or `null` both mean no structured subject was provided.

**title** `string` *required*

Human-readable title for the permission prompt.

This title is specific to the permission prompt and does not update any
subject's displayed title.

#### RequestPermissionResponse

Response to a permission request.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**outcome** *required*

The user's decision on the permission request.

### session/update

Handles session update notifications from the agent.

This is a notification endpoint (no response expected) that receives
updates about session activity, including message updates, message chunks,
tool calls, and execution plans.

Note: Clients SHOULD continue accepting tool call updates even after
sending a `session/cancel` notification, as the agent may send final
updates before reporting an idle `state_update` with the cancelled
stop reason.

See protocol docs: [Agent Reports Output](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#3-agent-reports-output)

#### UpdateSessionNotification

Notification containing a session update from the agent.

Agents can send session updates at any point while the session exists.

See protocol docs: [Agent Reports Output](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#3-agent-reports-output)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**sessionId** *required*

The ID of the session this update pertains to.

**update** *required*

The actual update content.

## Protocol Level

Defines the interface that ACP-compliant agents and clients must both implement.

Notifications whose methods start with '$/' are messages which are protocol
implementation dependent and might not be implementable in all clients or
agents. For example if the implementation uses a single threaded synchronous
programming language then there is little it can do to react to a `$/cancel\_request\` notification. If an agent or client receives notifications
starting with '\$/' it is free to ignore the notification.

### \$/cancel\_request

Cancels an ongoing request.

This is a notification sent by the side that sent a request to cancel that request.

Upon receiving this notification, the receiver:

1. MAY cancel the corresponding request activity and all nested activities
2. MAY send any pending notifications.
3. MUST send one of these responses for the original request:

* Valid response with appropriate data (partial results or cancellation marker)
* Error response with code `-32800` (Cancelled)

See protocol docs: [Cancellation](https://agentclientprotocol.com/protocol/v2/cancellation.md)

#### CancelRequestNotification

Notification to cancel an ongoing request.

See protocol docs: [Cancellation](https://agentclientprotocol.com/protocol/v2/cancellation.md)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**requestId** *required*

The ID of the request to cancel.

## AbsolutePath

An absolute filesystem path used by the protocol.

**Type:** `string`

## AgentAuthCapabilities

Authentication-related extension capabilities supported by the agent.

This object does not advertise support for `auth/login` or `auth/logout`.
Those methods are advertised by a non-empty `authMethods` list in the
`initialize` response.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## AgentCapabilities

Capabilities supported by the agent.

Advertised during initialization to inform the client about
available features and content types.

See protocol docs: [Agent Capabilities](https://agentclientprotocol.com/protocol/v2/initialization.md#agent-capabilities)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**auth**

Authentication-related extension capabilities supported by the agent.

Optional. Omitted or `null` both mean the agent does not advertise any
authentication-related extensions. This field does not advertise support
for `auth/login` or `auth/logout`; those methods are advertised by a
non-empty `authMethods` list in the `initialize` response.

**session**

Session capabilities supported by the agent.

Optional. Omitted or `null` both mean the agent does not support the
`session/*` method surface. Supplying `\{\}` means the agent supports the
baseline session methods: `session/new`, `session/list`,
`session/resume`, `session/close`, `session/prompt`, `session/cancel`,
and `session/update`.

## AgentMessage

An agent message upsert.

Only `AgentMessage::message_id` is required. `content` has patch semantics:
an omitted field leaves existing message content unchanged, `null` clears the
value, and a concrete array replaces the previous value. For a new
`messageId`, omitted fields use client defaults. `content` is replaced as a
whole array; send `[]` or `null` to clear it.

Message updates and chunks are applied in the order they are received. When
an `agent_message` update includes `content`, that array replaces any
content previously accumulated for the message, including content from
earlier chunks. Later chunks with the same `messageId` append to the current
content.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**content**

Complete replacement content for this message.

**messageId** *required*

A unique identifier for the message.

## AgentThought

An agent thought or reasoning message upsert.

Only `AgentThought::message_id` is required. `content` has patch semantics:
an omitted field leaves existing thought content unchanged, `null` clears the
value, and a concrete array replaces the previous value. For a new
`messageId`, omitted fields use client defaults. `content` is replaced as a
whole array; send `[]` or `null` to clear it.

Message updates and chunks are applied in the order they are received. When
an `agent_thought` update includes `content`, that array replaces any
content previously accumulated for the thought, including content from
earlier chunks. Later chunks with the same `messageId` append to the current
content.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**content**

Complete replacement content for this thought message.

**messageId** *required*

A unique identifier for the thought message.

## Annotations

Optional annotations for the client. The client can use annotations to inform how objects are used or displayed

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**audience**

Intended recipients for this content, such as the user or assistant.

**lastModified** `string | null`

Timestamp indicating when the underlying resource was last modified.

Must be an RFC 3339 formatted string (e.g., "2025-01-12T15:00:58Z").

* Format: `date-time`

**priority** `number | null`

Relative importance of this content when clients choose what to surface.

| Constraint | Value |
| - | - |
| Minimum | `0` |
| Maximum | `1` |

## AudioContent

Audio provided to or from an LLM.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**annotations**

Optional annotations that help clients decide how to display or route this content.

**data** `string` *required*

Base64-encoded media payload.

* Content encoding: `base64`

**mimeType** *required*

MIME type describing the encoded media payload.

## AuthCapabilities

Authentication capabilities supported by the client.

Advertised during initialization to inform the agent which authentication
method types the client can handle. This governs opt-in types that require
additional client-side support.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**terminal**

Whether the client supports `terminal` authentication methods.

Optional. Omitted or `null` both mean the client does not advertise support.
The client should supply `\{\}` only when it can reproduce the configured
agent invocation in an interactive terminal. Supplying `\{\}` means the
agent may include `terminal` entries in its authentication methods.

## AuthMethod

Describes an available authentication method.

The `type` field acts as the discriminator in the serialized JSON form.

**Type:** Union

**terminal** `object`

Client runs the configured agent program as a separate interactive
process, without passing this method to `auth/login`.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**args**

Additional arguments to append to the configured agent invocation for terminal auth.

**description** `string | null`

Optional description providing more details about this authentication method.

**env**

Additional environment variables to set on the configured agent invocation for terminal auth.
Names MUST be unique. These values override same-named variables in the
base launch configuration.

**methodId** *required*

Unique identifier for this authentication method.

**name** `string` *required*

Human-readable name of the authentication method.

**type** `string` *required*

The discriminator value. Must be `"terminal"`.

**agent** `object`

Agent handles authentication itself through `auth/login`.

The `type` discriminator value is `agent`.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**description** `string | null`

Optional description providing more details about this authentication method.

**methodId** *required*

Unique identifier for this authentication method.

**name** `string` *required*

Human-readable name of the authentication method.

**type** `string` *required*

The discriminator value. Must be `"agent"`.

**other** `object`

Custom or future authentication method.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Clients that do not understand this method type should preserve the raw
payload when storing, replaying, proxying, or forwarding initialization
data, and otherwise ignore the method or display it generically.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**description** `string | null`

Optional description providing more details about this authentication method.

**methodId** *required*

Unique identifier for this authentication method.

**name** `string` *required*

Human-readable name of the authentication method.

**type** `string` *required*

Custom or future authentication method type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## AuthMethodAgent

Agent handles authentication itself through `auth/login`.

The `type` discriminator value is `agent`.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**description** `string | null`

Optional description providing more details about this authentication method.

**methodId** *required*

Unique identifier for this authentication method.

**name** `string` *required*

Human-readable name of the authentication method.

## AuthMethodId

Typed identifier used for auth method values on the wire.

**Type:** `string`

## AuthMethodTerminal

Terminal-based authentication method.

The client runs the configured agent program as a separate interactive
process for the user to authenticate via a TUI. Agents MUST advertise this
method only when the client enabled its terminal authentication capability.
A zero exit status signals success; any other termination signals failure.
The client MUST NOT pass this method to `auth/login`.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**args**

Additional arguments to append to the configured agent invocation for terminal auth.

**description** `string | null`

Optional description providing more details about this authentication method.

**env**

Additional environment variables to set on the configured agent invocation for terminal auth.
Names MUST be unique. These values override same-named variables in the
base launch configuration.

**methodId** *required*

Unique identifier for this authentication method.

**name** `string` *required*

Human-readable name of the authentication method.

## AvailableCommand

Information about a command.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**description** `string` *required*

Human-readable description of what the command does.

**input**

Input for the command if required

**name** `string` *required*

Command name (e.g., `create_plan`, `research_codebase`).

## AvailableCommandInput

The input specification for a command.

**Type:** Union

**text** `object`

All text that was typed after the command name is provided as input.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**hint** `string` *required*

A hint to display when the input hasn't been provided yet

**type** `string` *required*

The discriminator value. Must be `"text"`.

**other** `object`

Custom or future command input specification.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Clients that do not understand this input type should preserve the raw
payload when storing, replaying, proxying, or forwarding command
metadata, and otherwise ignore the input specification or display the
command without structured input.

**Properties**

**type** `string` *required*

Custom or future command input type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## AvailableCommandsUpdate

Available commands are ready or have changed

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**availableCommands** *required*

Commands the agent can execute.

## BlobResourceContents

Binary resource contents.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**blob** `string` *required*

Base64-encoded bytes for a binary resource payload.

* Content encoding: `base64`

**mimeType**

MIME type describing the encoded media payload.

**uri** `string` *required*

URI associated with this resource or media payload.

* Format: `uri`

## BooleanPropertySchema

Schema for boolean properties in an elicitation form.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**default** `boolean | null`

Default value.

Optional. Omitted and `null` are equivalent and mean no default value is provided.

**description** `string | null`

Human-readable description.

Optional. Omitted and `null` are equivalent and mean no description is provided.

**title** `string | null`

Optional title for the property.

Optional. Omitted and `null` are equivalent and mean no title is provided.

## ClientCapabilities

Capabilities supported by the client.

Advertised during initialization to inform the agent about
available features and methods.

See protocol docs: [Client Capabilities](https://agentclientprotocol.com/protocol/v2/initialization.md#client-capabilities)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**auth**

Authentication capabilities supported by the client.
Determines which authentication method types the agent may include
in its `InitializeResponse`.

Optional. Omitted or `null` both mean the client does not advertise any
authentication-method extensions.

**elicitation**

Elicitation capabilities supported by the client.
Determines which elicitation modes the agent may use.

Optional. Omitted or `null` both mean the client does not advertise
elicitation support.

## CommandPermissionSubject

Permission request details for a command.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. Omitted and `null` are equivalent and mean no subject metadata was provided.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**command** `string` *required*

The command that would be run if permission is granted.

**cwd** *required*

The absolute working directory for the command.

**terminalId**

The associated terminal, when already known. Omitted and `null` are equivalent.

**toolCallId**

The associated tool call, when known. Omitted and `null` are equivalent.

## CompactionId

Unique identifier for a context compaction within a session.

**Type:** `string`

## CompactionStatus

Lifecycle state of a context compaction.

**Type:** Union

**in\_progress** `string`

Compaction has started and has not finished.

**completed** `string`

Compaction finished successfully.

**failed** `string`

Compaction finished unsuccessfully.

**cancelled** `string`

Compaction was cancelled before it finished.

**other** `string`

Custom or future compaction status.

Values beginning with `_` are reserved for implementation-specific
extensions. Other unknown values are reserved for future ACP statuses.

## CompactionSummaryChunk

A content block appended to a compaction's summary. A first-seen ID creates
an in-progress compaction. Chunks append in receive order.

**Type:** Object

**Properties:**

**\_meta** `object | null`

Metadata scoped to this chunk. Omission and `null` both mean absent.

**compactionId** *required*

ID of the compaction whose summary receives this content.

**content** *required*

One content block to append.

## CompactionUpdate

A context compaction upsert. The first notification fixes the compaction's
timeline position. Later updates with the same ID patch that entity in place.

`summary`, `error`, and `_meta` have patch semantics: omission leaves the
stored value unchanged, `null` clears it, and a concrete value replaces it.
`summary: []` also clears the summary. A concrete `_meta` object patches the
stored metadata by top-level key instead of replacing it.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**compactionId** *required*

The Agent-owned ID of this compaction, unique within the session.

**error** `string | null`

Human-readable error details for the compaction.

**status** *required*

Current lifecycle status.

**summary**

Complete replacement user-displayable summary content for the compaction.

## ConfigOptionUpdate

Session configuration options have been updated.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**configOptions** *required*

The full set of configuration options and their current values.

## Content

Standard content block (text, images, resources).

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**content** *required*

The actual content block.

## ContentBlock

Content blocks represent displayable information in the Agent Client Protocol.

They provide a structured way to handle various types of user-facing content—whether
it's text from language models, images for analysis, or embedded resources for context.

Content blocks appear in:

* User prompts sent via `session/prompt`
* Language model output reported through `session/update` notifications as
  message updates or streamed chunks
* Progress updates and results from tool calls

This structure is compatible with the Model Context Protocol (MCP), enabling
agents to seamlessly forward content from MCP tool outputs without transformation.

See protocol docs: [Content](https://agentclientprotocol.com/protocol/v2/content.md)

**Type:** Union

**text** `object`

Text content. May be plain text or formatted with Markdown.

All agents MUST support text content blocks in prompts.
Clients SHOULD render this text as Markdown.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**annotations**

Optional annotations that help clients decide how to display or route this content.

**text** `string` *required*

Text payload carried by this content block.

**type** `string` *required*

The discriminator value. Must be `"text"`.

**image** `object`

Images for visual context or analysis.

Requires the `image` prompt capability when included in prompts.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**annotations**

Optional annotations that help clients decide how to display or route this content.

**data** `string` *required*

Base64-encoded media payload.

* Content encoding: `base64`

**mimeType** *required*

MIME type describing the encoded media payload.

**type** `string` *required*

The discriminator value. Must be `"image"`.

**uri** `string | null`

URI associated with this resource or media payload.

* Format: `uri`

**audio** `object`

Audio data for transcription or analysis.

Requires the `audio` prompt capability when included in prompts.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**annotations**

Optional annotations that help clients decide how to display or route this content.

**data** `string` *required*

Base64-encoded media payload.

* Content encoding: `base64`

**mimeType** *required*

MIME type describing the encoded media payload.

**type** `string` *required*

The discriminator value. Must be `"audio"`.

**resource\_link** `object`

References to resources that the agent can access.

All agents MUST support resource links in prompts.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**annotations**

Optional annotations that help clients decide how to display or route this content.

**description** `string | null`

Optional human-readable details shown with this protocol object.

**icons**

Optional set of sized icons that the client can display in a user interface.

**mimeType**

MIME type describing the encoded media payload.

**name** `string` *required*

Human-readable name shown for this protocol object.

**size** `integer | null`

Optional size of the linked resource in bytes, if known.

**title** `string | null`

Optional display title for end-user UI.

**type** `string` *required*

The discriminator value. Must be `"resource_link"`.

**uri** `string` *required*

URI associated with this resource or media payload.

* Format: `uri`

**resource** `object`

Complete resource contents embedded directly in the message.

Preferred for including context as it avoids extra round-trips.

Requires the `embeddedContext` prompt capability when included in prompts.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**annotations**

Optional annotations that help clients decide how to display or route this content.

**resource** *required*

Embedded resource payload, either text or binary data.

**type** `string` *required*

The discriminator value. Must be `"resource"`.

**other** `object`

Custom or future content block.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Receivers that do not understand this content block type should preserve
the raw payload when storing, replaying, proxying, or forwarding content,
and otherwise ignore it or display it generically.

**Properties**

**type** `string` *required*

Custom or future content block type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## ContentChunk

A streamed item of message content.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. This field is chunk-scoped.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**content** *required*

A single item of content

**messageId** *required*

A unique identifier for the message this chunk belongs to.

All chunks belonging to the same message share the same `messageId`.
A change in `messageId` indicates a new message has started.

## Cost

Cost information for a session.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**amount** `number` *required*

Total cumulative cost for session.

**currency** `string` *required*

ISO 4217 currency code (e.g., "USD", "EUR").

* Pattern: `"^[A-Z]{3}$"`

## Diff

File changes produced by a tool call.

`changes` is authoritative for affected absolute paths and operations.
`patch` optionally carries renderable text for some or all of those changes
and MUST be consistent with `changes`. Agents SHOULD provide `patch` whenever
feasible. Clients MUST handle diffs where `patch` is omitted or `null`.

See protocol docs: [Content](https://agentclientprotocol.com/protocol/v2/tool-calls.md#content)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**changes** *required*

Structured file changes described by this diff.

Clients can use this field without parsing patch text to determine affected paths.

**patch**

Renderable patch text for some or all of the structured changes.

Agents SHOULD provide patch text whenever feasible. Omitted or `null`
means no renderable patch text was provided.

## DiffChange

One file-level change described by a `Diff`.

Structured change metadata lets clients identify affected files and
operations without parsing the text patch.

**Type:** Union

**Shared properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**fileType**

File content kind.

Omitted or `null` means the content kind is unknown.

**mimeType**

MIME type of the file contents.

Omitted or `null` means the MIME type is unknown.

**Variants:**

**add** `object`

A file was added.

**Properties**

**operation** `string` *required*

The discriminator value. Must be `"add"`.

**path** *required*

Absolute path for the operation.

**delete** `object`

A file was deleted.

**Properties**

**operation** `string` *required*

The discriminator value. Must be `"delete"`.

**path** *required*

Absolute path for the operation.

**modify** `object`

A file was modified in place.

**Properties**

**operation** `string` *required*

The discriminator value. Must be `"modify"`.

**path** *required*

Absolute path for the operation.

**move** `object`

A file was moved or renamed.

**Properties**

**oldPath** *required*

Absolute path before the operation.

**operation** `string` *required*

The discriminator value. Must be `"move"`.

**path** *required*

Absolute path after the operation.

**copy** `object`

A file was copied.

**Properties**

**oldPath** *required*

Absolute path before the operation.

**operation** `string` *required*

The discriminator value. Must be `"copy"`.

**path** *required*

Absolute path after the operation.

**other** `object`

Custom or future file operation.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**Properties**

**operation** `string` *required*

Custom or future file operation.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## DiffFileType

Kind of file content represented by a diff change.

**Type:** Union

**text** `string`

Text content.

**binary** `string`

Binary or otherwise non-text content.

**directory** `string`

Directory entry.

**symlink** `string`

Symbolic link.

**other** `string`

Custom or future file type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## DiffPatch

Renderable patch text and its format.

**Type:** Object

**Properties:**

**format** *required*

Patch format. The only ACP-defined value is `git_patch`.

**text** `string` *required*

Patch text in the format named by `format`.

## DiffPatchFormat

Text patch format used by `DiffPatch`.

**Type:** Union

**git\_patch** `string`

One or more `diff --git` sections in Git's `--patch` (`-p`) text format.

Unlike Git, which writes paths relative to the repository root, every
path MUST be absolute, including in `rename from`, `rename to`,
`copy from`, and `copy to` lines, and MUST NOT have a prefix such as
Git's default `a/` and `b/`. Otherwise paths follow Git: `/dev/null`
names the missing side of an added or deleted file in the `---` and
`+++` lines, and paths with unusual characters are quoted as Git quotes
them. Surrounding commit metadata and email envelopes MUST NOT be
included.

**other** `string`

Custom or future patch format.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## DiffPathChange

Operation metadata for add, delete, and modify changes.

**Type:** Object

**Properties:**

**path** *required*

Absolute path for the operation.

## DiffPathPairChange

Operation metadata for move and copy changes.

**Type:** Object

**Properties:**

**oldPath** *required*

Absolute path before the operation.

**path** *required*

Absolute path after the operation.

## ElicitationAcceptAction

The user accepted the elicitation and provided content.

**Type:** Object

**Properties:**

**content** `object | null`

The user-provided content, if any, as an object matching the requested schema.

## ElicitationCapabilities

Elicitation capabilities supported by the client.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**form**

Whether the client supports form-based elicitation.

Optional. Omitted and `null` are equivalent and mean form support is not advertised.
Supplying `\{\}` explicitly advertises form support.

**url**

Whether the client supports URL-based elicitation.

Optional. Omitted or `null` both mean the client does not advertise support.
Supplying `\{\}` means the client supports URL-based elicitation.

## ElicitationContentValue

Allowed wire representations for `ElicitationContentValue`.

**Type:** Union

**String** `string`

String value accepted in elicitation response content.

**Integer** `int64`

Integer value accepted in elicitation response content.

**Number** `double`

Number value accepted in elicitation response content.

**Boolean** `boolean`

Boolean value accepted in elicitation response content.

**StringArray** `array`

String array value accepted in elicitation response content.

## ElicitationFormCapabilities

Form-based elicitation capabilities.

Supplying `\{\}` means the client supports form-based elicitation.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## ElicitationFormMode

Form-based elicitation mode where the client renders a form from the provided schema.

**Type:** Union

**Shared properties:**

**requestedSchema** *required*

A JSON Schema describing the form fields to present to the user.

**Variants:**

**Session**

Tied to a session, optionally to a specific tool call within that session.

**Properties**

**sessionId** *required*

The session this elicitation is tied to.

**toolCallId**

Optional tool call within the session.

Optional. Omitted and `null` are equivalent and mean the elicitation is scoped to the
session without a specific tool call.

**Request**

Tied to a specific JSON-RPC request outside of a session
(e.g., during auth/configuration phases before any session is started).

**Properties**

**requestId** *required*

The request this elicitation is tied to.

## ElicitationId

Unique identifier for an elicitation.

**Type:** `string`

## ElicitationPropertySchema

Property schema for elicitation form fields.

Each variant corresponds to a JSON Schema `"type"` value.
Single-select enums use the `String` variant with `enum` or `oneOf` set.
Multi-select enums use the `Array` variant.

**Type:** Union

**string** `object`

String property (or single-select enum when `enum`/`oneOf` is set).

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**default** `string | null`

Default value.

Optional. Omitted and `null` are equivalent and mean no default value is provided.

**description** `string | null`

Human-readable description.

Optional. Omitted and `null` are equivalent and mean no description is provided.

**enum**

Enum values for untitled single-select enums.
Must contain at least one value when present.
Optional. Omitted and `null` are equivalent and mean no untitled single-select choices are
declared by `enum`.

**format**

String format.

Optional. Omitted and `null` are equivalent and mean there is no format constraint.

**maxLength** `integer | null`

Maximum string length.

Optional. Omitted and `null` are equivalent and mean there is no maximum length constraint.

* Minimum: `0`

**minLength** `integer | null`

Minimum string length.

Optional. Omitted and `null` are equivalent and mean there is no minimum length constraint.

* Minimum: `0`

**oneOf**

Titled enum options for titled single-select enums.
Must contain at least one option when present.
Optional. Omitted and `null` are equivalent and mean no titled single-select choices are
declared by `oneOf`.

**pattern** `string | null`

Pattern the string must match.

Optional. Omitted and `null` are equivalent and mean there is no pattern constraint.

* Format: `regex`

**title** `string | null`

Optional title for the property.

Optional. Omitted and `null` are equivalent and mean no title is provided.

**type** `string` *required*

The discriminator value. Must be `"string"`.

**number** `object`

Number (floating-point) property.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**default** `number | null`

Default value.

Optional. Omitted and `null` are equivalent and mean no default value is provided.

**description** `string | null`

Human-readable description.

Optional. Omitted and `null` are equivalent and mean no description is provided.

**maximum** `number | null`

Maximum value (inclusive).

Optional. Omitted and `null` are equivalent and mean there is no inclusive upper bound.

**minimum** `number | null`

Minimum value (inclusive).

Optional. Omitted and `null` are equivalent and mean there is no inclusive lower bound.

**title** `string | null`

Optional title for the property.

Optional. Omitted and `null` are equivalent and mean no title is provided.

**type** `string` *required*

The discriminator value. Must be `"number"`.

**integer** `object`

Integer property.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**default** `integer | null`

Default value.

Optional. Omitted and `null` are equivalent and mean no default value is provided.

**description** `string | null`

Human-readable description.

Optional. Omitted and `null` are equivalent and mean no description is provided.

**maximum** `integer | null`

Maximum value (inclusive).

Optional. Omitted and `null` are equivalent and mean there is no inclusive upper bound.

**minimum** `integer | null`

Minimum value (inclusive).

Optional. Omitted and `null` are equivalent and mean there is no inclusive lower bound.

**title** `string | null`

Optional title for the property.

Optional. Omitted and `null` are equivalent and mean no title is provided.

**type** `string` *required*

The discriminator value. Must be `"integer"`.

**boolean** `object`

Boolean property.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**default** `boolean | null`

Default value.

Optional. Omitted and `null` are equivalent and mean no default value is provided.

**description** `string | null`

Human-readable description.

Optional. Omitted and `null` are equivalent and mean no description is provided.

**title** `string | null`

Optional title for the property.

Optional. Omitted and `null` are equivalent and mean no title is provided.

**type** `string` *required*

The discriminator value. Must be `"boolean"`.

**array** `object`

Multi-select array property.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**default**

Default selected values.

Optional. Omitted and `null` are equivalent and mean no default selections are provided.

**description** `string | null`

Human-readable description.

Optional. Omitted and `null` are equivalent and mean no description is provided.

**items** *required*

The items definition describing allowed values.

**maxItems** `integer | null`

Maximum number of items to select.

Optional. Omitted and `null` are equivalent and mean there is no maximum selection count.

* Minimum: `0`

**minItems** `integer | null`

Minimum number of items to select.

Optional. Omitted and `null` are equivalent and mean there is no minimum selection count.

* Minimum: `0`

**title** `string | null`

Optional title for the property.

Optional. Omitted and `null` are equivalent and mean no title is provided.

**type** `string` *required*

The discriminator value. Must be `"array"`.

**other** `object`

Custom or future elicitation property schema.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Clients that do not understand this property schema type should preserve
the raw schema when storing, replaying, proxying, or forwarding
elicitation requests. They MUST NOT render it as a known input control.

**Properties**

**type** `string` *required*

Custom or future elicitation property schema type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## ElicitationRequestScope

Request-scoped elicitation, tied to a specific JSON-RPC request outside of a session
(e.g., during auth/configuration phases before any session is started).

**Type:** Object

**Properties:**

**requestId** *required*

The request this elicitation is tied to.

## ElicitationSchema

Type-safe elicitation schema for requesting structured user input.

This represents a JSON Schema object with primitive-typed properties,
as required by the elicitation specification.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**description** `string | null`

Optional description of what this schema represents.

Optional. Omitted and `null` are equivalent and mean no schema description is provided.

**properties** `object`

Property definitions (must be primitive types).

* Default: `{}`

**required**

List of required property names.

Optional. Omitted and `null` are equivalent and mean no property names are required.

**title** `string | null`

Optional title for the schema.

Optional. Omitted and `null` are equivalent and mean no title is provided.

**type**

Type discriminator. Always `"object"`.

* Default: `"object"`

## ElicitationSchemaType

Type discriminator for elicitation schemas.

**Type:** Union

**object** `string`

Object schema type.

## ElicitationSessionScope

Session-scoped elicitation, optionally tied to a specific tool call.

When `tool_call_id` is set, the elicitation is tied to a specific tool call.
This is useful when an agent receives an elicitation from an MCP server
during a tool call and needs to redirect it to the user.

**Type:** Object

**Properties:**

**sessionId** *required*

The session this elicitation is tied to.

**toolCallId**

Optional tool call within the session.

Optional. Omitted and `null` are equivalent and mean the elicitation is scoped to the
session without a specific tool call.

## ElicitationUrlCapabilities

URL-based elicitation capabilities.

Supplying `\{\}` means the client supports URL-based elicitation.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## ElicitationUrlMode

URL-based elicitation mode where the client directs the user to a URL.

**Type:** Union

**Shared properties:**

**elicitationId** *required*

The unique identifier for this elicitation.

**url** `string` *required*

The URL to direct the user to.

* Format: `uri`

**Variants:**

**Session**

Tied to a session, optionally to a specific tool call within that session.

**Properties**

**sessionId** *required*

The session this elicitation is tied to.

**toolCallId**

Optional tool call within the session.

Optional. Omitted and `null` are equivalent and mean the elicitation is scoped to the
session without a specific tool call.

**Request**

Tied to a specific JSON-RPC request outside of a session
(e.g., during auth/configuration phases before any session is started).

**Properties**

**requestId** *required*

The request this elicitation is tied to.

## EmbeddedResource

The contents of a resource, embedded into a prompt or tool call result.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**annotations**

Optional annotations that help clients decide how to display or route this content.

**resource** *required*

Embedded resource payload, either text or binary data.

## EmbeddedResourceResource

Resource content that can be embedded in a message.

**Type:** Union

**TextResourceContents**

Text resource contents embedded directly in the message.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**mimeType**

MIME type describing the encoded media payload.

**text** `string` *required*

Text payload carried by this content block.

**uri** `string` *required*

URI associated with this resource or media payload.

* Format: `uri`

**BlobResourceContents**

Binary resource contents embedded directly in the message.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**blob** `string` *required*

Base64-encoded bytes for a binary resource payload.

* Content encoding: `base64`

**mimeType**

MIME type describing the encoded media payload.

**uri** `string` *required*

URI associated with this resource or media payload.

* Format: `uri`

## EnumOption

A titled enum option with a const value, human-readable title, and optional description.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**const** `string` *required*

The constant value for this option.

**description** `string | null`

Human-readable description.

Optional. Omitted and `null` are equivalent and mean no description is provided.

**title** `string` *required*

Human-readable title for this option.

## EnvVariable

An environment variable to set when launching a process.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**name** `string` *required*

The name of the environment variable.

**value** `string` *required*

The value to set for the environment variable.

## Error

JSON-RPC error object.

Represents an error that occurred during method execution, following the
JSON-RPC 2.0 error object specification with optional additional data.

See protocol docs: [JSON-RPC Error Object](https://www.jsonrpc.org/specification#error_object)

**Type:** Object

**Properties:**

**code** *required*

A number indicating the error type that occurred. This must be an integer as
defined in the JSON-RPC specification.

**data** `object`

Optional primitive or structured value that contains additional information
about the error. This may include debugging information or context-specific
details.

**message** `string` *required*

A string providing a short description of the error. The message should be
limited to a concise single sentence.

## ErrorCode

Predefined error codes for common JSON-RPC and ACP-specific errors.

These codes follow the JSON-RPC 2.0 specification for standard errors
and use the reserved range (-32000 to -32099) for protocol-specific errors.

**Type:** Union

**-32700** `int32`

**Parse error**: Invalid JSON was received by the server. An error occurred on
the server while parsing the JSON text.

**-32600** `int32`

**Invalid request**: The JSON sent is not a valid Request object.

**-32601** `int32`

**Method not found**: The method does not exist or is not available.

**-32602** `int32`

**Invalid params**: Invalid method parameter(s).

**-32603** `int32`

**Internal error**: Internal JSON-RPC error. Reserved for
implementation-defined server errors.

**-32800** `int32`

**Request cancelled**: Execution of the method was aborted either due to a
cancellation request from the caller or because of resource constraints or
shutdown.

**-32000** `int32`

**Authentication required**: Authentication is required before this operation
can be performed.

**-32002** `int32`

**Resource not found**: A given resource, such as a file, was not found.

**-32022** `int32`

**Unsupported protocol version**: No protocol version supported by the Agent
is at or below the requested version. The error data contains the requested
version and the Agent's supported versions.

**Other** `int32`

Other undefined error code.

## ErrorStopReason

Details of a failure that ended active work.

**Type:** Object

**Properties:**

**error**

The failure, as a JSON-RPC error object.

Optional. Omitted or `null` both mean the agent is not reporting failure details.
Agents SHOULD include it.

## ExtNotification

Allows the Agent to send an arbitrary notification that is not part of the ACP spec.
Extension notifications provide a way to send one-way messages for custom functionality
while maintaining protocol compatibility.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## ExtRequest

Allows for sending an arbitrary request that is not part of the ACP spec.
Extension methods provide a way to add custom functionality while maintaining
protocol compatibility.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## ExtResponse

Allows for sending an arbitrary response to an `ExtRequest` that is not part of the ACP spec.
Extension methods provide a way to add custom functionality while maintaining
protocol compatibility.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## HttpHeader

An HTTP header to set when making requests to the MCP server.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**name** `string` *required*

The name of the HTTP header.

**value** `string` *required*

The value to set for the HTTP header.

## Icon

An optionally-sized icon that can be displayed in a user interface.

**Type:** Object

**Properties:**

**mimeType**

Optional MIME type override if the source MIME type is missing or generic.

**sizes**

Optional array of strings that specify sizes at which the icon can be used.
Each string should be in `WxH` format (e.g., `"48x48"`, `"96x96"`) or
`"any"` for scalable formats like SVG.

If not provided, the client should assume that the icon can be used at any size.

**src** `string` *required*

A standard URI pointing to an icon resource.

* Format: `uri`

**theme**

Optional theme this icon is designed for.

## IconTheme

Theme an icon is designed for.

**Type:** Union

**light** `string`

Icon designed for light backgrounds.

**dark** `string`

Icon designed for dark backgrounds.

**other** `string`

Custom or future icon theme.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## IdleStateUpdate

No foreground work is active. Background activity may continue.

Agents SHOULD include a `stopReason` when the idle transition ends foreground
work. An idle update that does not end foreground work need not include one.
Receivers treat an omitted, `null`, or malformed `stopReason` as the agent not
reporting one.
Repeated or resume snapshots may carry the last stop reason for context.
They MUST NOT be counted as new completions, cancellations, or additional usage.

**Type:** Union

**Shared properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**stopReason** `string | null`

Why foreground work stopped. The value selects one of this type's variants, which may add fields of their own.

Optional. Omitted or `null` both mean the agent is not reporting a stop reason; a malformed value is treated the same way.

See protocol docs: [Stop Reasons](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#stop-reasons)

**Variants:**

**end\_turn** `object`

The active work ended successfully.
Includes locally handled commands that required no model call.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"end_turn"`.

**max\_tokens** `object`

The active work ended because the agent reached the maximum number of tokens.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"max_tokens"`.

**max\_turn\_requests** `object`

The active work ended because the agent reached the maximum number of
allowed agent requests before returning idle.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"max_turn_requests"`.

**refusal** `object`

The active work ended because the agent refused to continue. The user
prompt and everything that comes after it won't be included in the next
prompt, so this should be reflected in the UI.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"refusal"`.

**cancelled** `object`

Active session work was cancelled by the client via `session/cancel`.

Agents MUST report this stop reason on an idle `state_update` when
cancellation ends active foreground work, even if aborting causes
exceptions. Agents MUST catch these errors and report `cancelled`, not
`error`.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"cancelled"`.

**error** `object`

The active work ended because something failed.

This includes pre-insertion foreground work. A prompt failure before
insertion also requires an error response to `session/prompt`; after
insertion, the prompt's response remains successful.

**Properties**

**error**

The failure, as a JSON-RPC error object.

Optional. Omitted or `null` both mean the agent is not reporting failure details.
Agents SHOULD include it.

**stopReason** `string` *required*

The discriminator value. Must be `"error"`.

**other** `object`

Custom or future stop reason.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**Properties**

**stopReason** `string` *required*

Custom or future stop reason.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**none** `object`

No stop reason: `stopReason` is omitted or `null`.

**Properties**

**stopReason** `null`

## ImageContent

An image provided to or from an LLM.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**annotations**

Optional annotations that help clients decide how to display or route this content.

**data** `string` *required*

Base64-encoded media payload.

* Content encoding: `base64`

**mimeType** *required*

MIME type describing the encoded media payload.

**uri** `string | null`

URI associated with this resource or media payload.

* Format: `uri`

## Implementation

Metadata about the implementation of the client or agent.
Describes the name and version of an ACP implementation, with an optional
title for UI representation.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**name** `string` *required*

Intended for programmatic or logical use, but can be used as a display
name fallback if title isn’t present.

**title** `string | null`

Intended for UI and end-user contexts — optimized to be human-readable
and easily understood.

If not provided, the name should be used for display.

**version** `string` *required*

Version of the implementation. Can be displayed to the user or used
for debugging or metrics purposes. (e.g. "1.0.0").

## IntegerPropertySchema

Schema for integer properties in an elicitation form.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**default** `integer | null`

Default value.

Optional. Omitted and `null` are equivalent and mean no default value is provided.

**description** `string | null`

Human-readable description.

Optional. Omitted and `null` are equivalent and mean no description is provided.

**maximum** `integer | null`

Maximum value (inclusive).

Optional. Omitted and `null` are equivalent and mean there is no inclusive upper bound.

**minimum** `integer | null`

Minimum value (inclusive).

Optional. Omitted and `null` are equivalent and mean there is no inclusive lower bound.

**title** `string | null`

Optional title for the property.

Optional. Omitted and `null` are equivalent and mean no title is provided.

## McpCapabilities

MCP capabilities supported by the agent for session lifecycle requests.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**http**

Agent supports `McpServer::Http`.

Optional. Omitted or `null` both mean the agent does not advertise support.
Supplying `\{\}` means the agent supports HTTP MCP server transports.

**stdio**

Agent supports `McpServer::Stdio`.

Optional. Omitted or `null` both mean the agent does not advertise support.
Supplying `\{\}` means the agent supports stdio MCP server transports.

## McpHttpCapabilities

Capabilities for HTTP MCP server transports.

Supplying `\{\}` means the agent supports HTTP MCP server transports.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## McpServer

Configuration for connecting to an MCP (Model Context Protocol) server.

MCP servers provide tools and context that the agent can use when
processing prompts.

See protocol docs: [MCP Servers](https://agentclientprotocol.com/protocol/v2/session-setup.md#mcp-servers)

**Type:** Union

**http** `object`

HTTP transport configuration

Only available when the Agent capabilities include `session.mcp.http`.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**headers**

HTTP headers to set when making requests to the MCP server.

**name** `string` *required*

Human-readable name identifying this MCP server.

**type** `string` *required*

The discriminator value. Must be `"http"`.

**url** `string` *required*

URL to the MCP server.

* Format: `uri`

**stdio** `object`

Stdio transport configuration

Only available when the Agent capabilities include `session.mcp.stdio`.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**args**

Command-line arguments to pass to the MCP server.

**command** *required*

Absolute path to the MCP server executable.

**env**

Environment variables to set when launching the MCP server.

**name** `string` *required*

Human-readable name identifying this MCP server.

**type** `string` *required*

The discriminator value. Must be `"stdio"`.

**other** `object`

Custom or future MCP server transport configuration.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Receivers that do not understand this transport should preserve the raw
payload when storing, replaying, proxying, or forwarding session setup
data, and otherwise ignore it or reject the server configuration.

**Properties**

**type** `string` *required*

Custom or future MCP server transport type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## McpServerHttp

HTTP transport configuration for MCP.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**headers**

HTTP headers to set when making requests to the MCP server.

**name** `string` *required*

Human-readable name identifying this MCP server.

**url** `string` *required*

URL to the MCP server.

* Format: `uri`

## McpServerStdio

Stdio transport configuration for MCP.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**args**

Command-line arguments to pass to the MCP server.

**command** *required*

Absolute path to the MCP server executable.

**env**

Environment variables to set when launching the MCP server.

**name** `string` *required*

Human-readable name identifying this MCP server.

## McpStdioCapabilities

Capabilities for stdio MCP server transports.

Supplying `\{\}` means the agent supports stdio MCP server transports.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## MediaType

An Internet media type identifying the format of protocol content.

**Type:** `string`

## MessageId

Identifier for a message, unique among messages of the same type within a session.

Each message type, such as user messages, agent messages, and agent thoughts,
has its own ID space: messages of different types may share an ID and remain
distinct messages.

**Type:** `string`

## MultiSelectItems

Items for a multi-select (array) property schema.

**Type:** Union

**string** `object`

Multi-select string items with plain string values.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**enum** *required*

Allowed enum values. Must contain at least one value.

**type** `string` *required*

The discriminator value. Must be `"string"`.

**other** `object`

Custom or future typed multi-select items.

**Properties**

**type** `string` *required*

Custom or future multi-select item type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**titled**

Titled multi-select items with human-readable labels.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**anyOf** *required*

Titled enum options. Must contain at least one option.

## MultiSelectPropertySchema

Schema for multi-select (array) properties in an elicitation form.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**default**

Default selected values.

Optional. Omitted and `null` are equivalent and mean no default selections are provided.

**description** `string | null`

Human-readable description.

Optional. Omitted and `null` are equivalent and mean no description is provided.

**items** *required*

The items definition describing allowed values.

**maxItems** `integer | null`

Maximum number of items to select.

Optional. Omitted and `null` are equivalent and mean there is no maximum selection count.

* Minimum: `0`

**minItems** `integer | null`

Minimum number of items to select.

Optional. Omitted and `null` are equivalent and mean there is no minimum selection count.

* Minimum: `0`

**title** `string | null`

Optional title for the property.

Optional. Omitted and `null` are equivalent and mean no title is provided.

## Notice

Fire-and-forget information for the user.

Notices are live events rather than session history. Agents must not rely on
a notice being received, displayed, or seen by the user.
No Client capability is required, and unsupported Clients may ignore notices.

See RFD: [Session Notices](https://agentclientprotocol.com/rfds/session-notices.md)

**Type:** Object

**Properties:**

**\_meta** `object | null`

Metadata scoped to this notice.

Omitted and `null` are equivalent and mean no metadata was supplied.

**description** `string | null`

Optional plain-text detail or guidance.

Omitted and `null` are equivalent and mean no description was supplied.

**severity** *required*

Presentation severity hint.

**title** `string` *required*

Required non-empty plain-text title that can stand alone.

* Min length: `1`

## NoticeSeverity

Severity hint for a session notice.

**Type:** Union

**info** `string`

Informational notice.

**warning** `string`

Warning notice.

**error** `string`

Error notice.

**other** `string`

Custom or future notice severity.

Values beginning with `_` are reserved for implementation-specific
extensions. Other unknown values are reserved for future ACP severities.

## NumberPropertySchema

Schema for number (floating-point) properties in an elicitation form.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**default** `number | null`

Default value.

Optional. Omitted and `null` are equivalent and mean no default value is provided.

**description** `string | null`

Human-readable description.

Optional. Omitted and `null` are equivalent and mean no description is provided.

**maximum** `number | null`

Maximum value (inclusive).

Optional. Omitted and `null` are equivalent and mean there is no inclusive upper bound.

**minimum** `number | null`

Minimum value (inclusive).

Optional. Omitted and `null` are equivalent and mean there is no inclusive lower bound.

**title** `string | null`

Optional title for the property.

Optional. Omitted and `null` are equivalent and mean no title is provided.

## PermissionOption

An option presented to the user when requesting permission.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**kind** *required*

Hint about the nature of this permission option.

**name** `string` *required*

Human-readable label to display to the user.

**optionId** *required*

Unique identifier for this permission option.

## PermissionOptionId

Unique identifier for a permission option.

**Type:** `string`

## PermissionOptionKind

The type of permission option being presented to the user.

Helps clients choose appropriate icons and UI treatment.

**Type:** Union

**allow\_once** `string`

Allow this operation only this time.

**allow\_always** `string`

Allow this operation and remember the choice.

**reject\_once** `string`

Reject this operation only this time.

**reject\_always** `string`

Reject this operation and remember the choice.

**other** `string`

Custom or future permission option kind.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## PlanEntry

A single entry in the execution plan.

Represents a task or goal that the assistant intends to accomplish
as part of fulfilling the user's request.
See protocol docs: [Plan Entries](https://agentclientprotocol.com/protocol/v2/agent-plan.md#plan-entries)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**content** `string` *required*

Human-readable description of what this task aims to accomplish.

**priority** *required*

The relative importance of this task.
Used to indicate which tasks are most critical to the overall goal.

**status** *required*

Current execution status of this task.

## PlanEntryPriority

Priority levels for plan entries.

Used to indicate the relative importance or urgency of different
tasks in the execution plan.
See protocol docs: [Plan Entries](https://agentclientprotocol.com/protocol/v2/agent-plan.md#plan-entries)

**Type:** Union

**high** `string`

High priority task - critical to the overall goal.

**medium** `string`

Medium priority task - important but not critical.

**low** `string`

Low priority task - nice to have but not essential.

**other** `string`

Custom or future plan entry priority.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## PlanEntryStatus

Status of a plan entry in the execution flow.

Tracks the lifecycle of each task from planning through completion.
See protocol docs: [Plan Entries](https://agentclientprotocol.com/protocol/v2/agent-plan.md#plan-entries)

**Type:** Union

**pending** `string`

The task has not started yet.

**in\_progress** `string`

The task is currently being worked on.

**completed** `string`

The task has been successfully completed.

**cancelled** `string`

The task was cancelled before it completed.

**other** `string`

Custom or future plan entry status.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## PlanId

Unique identifier for a plan within a session.

**Type:** `string`

## PlanItems

A plan represented as structured entries.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**entries** *required*

The list of tasks to be accomplished.

When updating an item-based plan, the agent must send a complete list of all entries
with their current status. The client replaces that plan with each update.

**planId** *required*

The plan ID to update.

## PlanUpdate

A content update for a plan identified by ID.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**plan** *required*

The updated plan content.

## PlanUpdateContent

Updated content for a plan.

**Type:** Union

**items** `object`

Structured plan entries.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**entries** *required*

The list of tasks to be accomplished.

When updating an item-based plan, the agent must send a complete list of all entries
with their current status. The client replaces that plan with each update.

**planId** *required*

The plan ID to update.

**type** `string` *required*

The discriminator value. Must be `"items"`.

**other** `object`

Custom or future plan update content.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Receivers that do not understand this content type should preserve the
raw payload when storing, replaying, proxying, or forwarding plans, and
otherwise ignore it or display it generically.

**Properties**

**planId** *required*

The plan ID to update.

**type** `string` *required*

Custom or future plan update content type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## PromptAudioCapabilities

Capabilities for audio content in prompt requests.

Supplying `\{\}` means the agent supports audio content in prompts.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## PromptCapabilities

Prompt capabilities supported by the agent in `session/prompt` requests.

Baseline agent functionality requires support for `ContentBlock::Text`
and `ContentBlock::ResourceLink` in prompt requests.

Other variants must be explicitly opted in to.
Capabilities for different types of content in prompt requests.

Indicates which content types beyond the baseline (text and resource links)
the agent can process.

See protocol docs: [Prompt Capabilities](https://agentclientprotocol.com/protocol/v2/initialization.md#prompt-capabilities)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**audio**

Agent supports `ContentBlock::Audio`.

Optional. Omitted or `null` both mean the agent does not advertise support.
Supplying `\{\}` means the agent supports audio content in prompts.

**embeddedContext**

Agent supports embedded context in `session/prompt` requests.

When enabled, the Client is allowed to include `ContentBlock::Resource`
in prompt requests for pieces of context that are referenced in the message.

Optional. Omitted or `null` both mean the agent does not advertise support.
Supplying `\{\}` means the agent supports embedded context in prompts.

**image**

Agent supports `ContentBlock::Image`.

Optional. Omitted or `null` both mean the agent does not advertise support.
Supplying `\{\}` means the agent supports image content in prompts.

## PromptEmbeddedContextCapabilities

Capabilities for embedded context in prompt requests.

Supplying `\{\}` means the agent supports embedded context in prompts.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## PromptImageCapabilities

Capabilities for image content in prompt requests.

Supplying `\{\}` means the agent supports image content in prompts.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## ProtocolVersion

Protocol version identifier.

This version is only bumped for breaking changes.
Non-breaking changes should be introduced via capabilities.

**Type:** `integer (uint16)`

| Constraint | Value |
| - | - |
| Minimum | `0` |
| Maximum | `65535` |

## ReplayFrom

Inclusive cursor describing where replayed session history should begin.

Replay includes the position identified by the cursor.

**Type:** Union

**start** `object`

Replay all retained conversation history from its first replayable entry.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**type** `string` *required*

The discriminator value. Must be `"start"`.

**other** `object`

Custom or future replay cursor.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Intermediaries SHOULD preserve the raw payload when storing, replaying,
proxying, or forwarding requests. Agents that do not support this cursor
MUST reject the request with `-32602` (Invalid params), rather than
substituting another cursor or resuming without replay.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**type** `string` *required*

Custom or future replay cursor type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## ReplayFromStart

Inclusive replay cursor requesting replay from the start of retained conversation history.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## RequestId

JSON RPC Request Id

An identifier established by the Client that MUST contain a String, Number, or NULL value if included. If it is not included it is assumed to be a notification. The value SHOULD normally not be Null \[1] and Numbers SHOULD NOT contain fractional parts \[2]

The Server MUST reply with the same value in the Response object if included. This member is used to correlate the context between the two objects.

\[1] The use of Null as a value for the id member in a Request object is discouraged, because this specification uses a value of Null for Responses with an unknown id. Also, because JSON-RPC 1.0 uses an id value of Null for Notifications this could cause confusion in handling.

\[2] Fractional parts may be problematic, since many decimal fractions cannot be represented exactly as binary fractions.

**Type:** Union

**null** `null`

The JSON-RPC `null` request id.

**Number** `int64`

A numeric JSON-RPC request id.

**Str** `string`

A string JSON-RPC request id.

## RequestPermissionOutcome

The outcome of a permission request.

**Type:** Union

**cancelled** `object`

Active session work was cancelled before the user responded.

When a client sends a `session/cancel` notification to cancel active
session work, it MUST respond to all pending `session/request_permission`
requests in that session with this `Cancelled` outcome, without answering
any request twice. Requests in other sessions are unaffected.

See protocol docs: [Cancellation](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#cancellation)

**Properties**

**outcome** `string` *required*

The discriminator value. Must be `"cancelled"`.

**selected** `object`

The user selected one of the provided options.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**optionId** *required*

The ID of the option the user selected.

**outcome** `string` *required*

The discriminator value. Must be `"selected"`.

**other** `object`

Custom or future permission outcome.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Agents that do not understand this outcome MUST NOT treat it as approval.
They should preserve the raw payload when storing, replaying, proxying, or
forwarding permission responses, and otherwise fail or decline the
permission request according to policy.

**Properties**

**outcome** `string` *required*

Custom or future permission outcome.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## RequestPermissionSubject

The operation requiring permission.

**Type:** Union

**tool\_call** `object`

Permission is requested before executing a tool call.

**Properties**

**toolCall** *required*

Details about the tool call requiring permission.

**type** `string` *required*

The discriminator value. Must be `"tool_call"`.

**command** `object`

Permission is requested before running a command.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. Omitted and `null` are equivalent and mean no subject metadata was provided.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**command** `string` *required*

The command that would be run if permission is granted.

**cwd** *required*

The absolute working directory for the command.

**terminalId**

The associated terminal, when already known. Omitted and `null` are equivalent.

**toolCallId**

The associated tool call, when known. Omitted and `null` are equivalent.

**type** `string` *required*

The discriminator value. Must be `"command"`.

**other** `object`

Custom or future permission subject.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Clients that do not understand this subject type should preserve the raw
payload when storing, replaying, proxying, or forwarding permission
requests, and otherwise display a generic permission prompt or decline it
according to policy.

**Properties**

**type** `string` *required*

Custom or future permission subject type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## RequiresActionStateUpdate

The foreground workflow as a whole is blocked on user action.

Agents SHOULD report this state when foreground work cannot progress without
user action. Pending permissions or elicitations alone do not imply this
state if other foreground work can progress, or if the requests belong only
to independent background activity. Once reported, agents MUST report
`running` when progress resumes, or `idle` if the work ends without resuming.
Responding to one request does not itself imply `running`.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## ResourceLink

A resource that the server is capable of reading, included in a prompt or tool call result.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**annotations**

Optional annotations that help clients decide how to display or route this content.

**description** `string | null`

Optional human-readable details shown with this protocol object.

**icons**

Optional set of sized icons that the client can display in a user interface.

**mimeType**

MIME type describing the encoded media payload.

**name** `string` *required*

Human-readable name shown for this protocol object.

**size** `integer | null`

Optional size of the linked resource in bytes, if known.

**title** `string | null`

Optional display title for end-user UI.

**uri** `string` *required*

URI associated with this resource or media payload.

* Format: `uri`

## Role

The sender or recipient of messages and data in a conversation.

**Type:** Union

**assistant** `string`

The assistant side of a conversation.

**user** `string`

The user side of a conversation.

**other** `string`

Custom or future role.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## RunningStateUpdate

Foreground work is in progress.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## SelectedPermissionOutcome

The user selected one of the provided options.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**optionId** *required*

The ID of the option the user selected.

## SessionAdditionalDirectoriesCapabilities

Capabilities for additional session directories support.

Supplying `\{\}` means the agent supports the `additionalDirectories` field on
supported session lifecycle requests. Agents that also support
`session/list` may return `SessionInfo.additionalDirectories` to report the
complete ordered additional-root list associated with a listed session.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## SessionCapabilities

Session capabilities supported by the agent.

Supplying `\{\}` means the agent supports the baseline session methods:
`session/new`, `session/list`, `session/resume`, `session/close`,
`session/prompt`, `session/cancel`, and `session/update`.

Agents that support sessions **MAY** support additional session methods,
prompt content types, and MCP transports by specifying additional
capabilities.

See protocol docs: [Session Capabilities](https://agentclientprotocol.com/protocol/v2/initialization.md#session-capabilities)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**additionalDirectories**

Whether the agent supports `additionalDirectories` on supported session lifecycle requests.

Optional. Omitted or `null` both mean the agent does not advertise support.
Supplying `\{\}` means the agent supports `additionalDirectories` on
supported session lifecycle requests.

Agents may return `SessionInfo.additionalDirectories` to report the
complete ordered additional-root list associated with a listed session.

**delete**

Whether the agent supports `session/delete`.

Optional. Omitted or `null` both mean the agent does not advertise support.
Supplying `\{\}` means the agent supports deleting sessions from `session/list`.

**mcp**

MCP capabilities supported by the agent for session lifecycle requests.

Optional. Omitted or `null` both mean the agent does not advertise MCP
server transport support for sessions.

**prompt**

Prompt capabilities supported by the agent in `session/prompt` requests.

Optional. Omitted or `null` both mean the agent does not advertise any
prompt extensions beyond the baseline text and resource-link content
required by `session/prompt`.

## SessionConfigBoolean

A boolean on/off toggle session configuration option payload.

**Type:** Object

**Properties:**

**currentValue** `boolean` *required*

The current value of the boolean option.

## SessionConfigGroupId

Unique identifier for a session configuration option value group.

**Type:** `string`

## SessionConfigId

Unique identifier for a session configuration option.

**Type:** `string`

## SessionConfigOption

A session configuration option selector and its current state.

**Type:** Union

**Shared properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**category**

Optional semantic category for this option (UX only).

**configId** *required*

Unique identifier for the configuration option.

**description** `string | null`

Optional description for the Client to display to the user.

**name** `string` *required*

Human-readable label for the option.

**Variants:**

**select** `object`

Single-value selector (dropdown).

**Properties**

**currentValue** *required*

The currently selected value.

**options** *required*

The set of selectable options.

**type** `string` *required*

The discriminator value. Must be `"select"`.

**boolean** `object`

Boolean on/off toggle.

**Properties**

**currentValue** `boolean` *required*

The current value of the boolean option.

**type** `string` *required*

The discriminator value. Must be `"boolean"`.

**other** `object`

Custom or future session configuration option payload.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Clients that do not understand this option type should preserve the raw
payload when storing, replaying, proxying, or forwarding configuration
data, and otherwise ignore the option or display it generically.

**Properties**

**type** `string` *required*

Custom or future session configuration option type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## SessionConfigOptionCategory

Semantic category for a session configuration option.

This is intended to help Clients distinguish broadly common selectors (e.g. model selector vs
session mode selector vs thought/reasoning level) for UX purposes (keyboard shortcuts, icons,
placement). It MUST NOT be required for correctness. Clients MUST handle missing or unknown
categories gracefully.

Category names beginning with `_` are free for custom use, like other ACP extension methods.
Category names that do not begin with `_` are reserved for the ACP spec.

**Type:** Union

**mode** `string`

Session mode selector.

**model** `string`

Model selector.

**model\_config** `string`

Model-related configuration parameter.

**thought\_level** `string`

Thought/reasoning level selector.

**other** `string`

Custom or future category.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## SessionConfigSelect

A single-value selector (dropdown) session configuration option payload.

**Type:** Object

**Properties:**

**currentValue** *required*

The currently selected value.

**options** *required*

The set of selectable options.

## SessionConfigSelectGroup

A group of possible values for a session configuration option.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**groupId** *required*

Unique identifier for this group.

**name** `string` *required*

Human-readable label for this group.

**options** *required*

The set of option values in this group.

## SessionConfigSelectOption

A possible value for a session configuration option.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**description** `string | null`

Optional description for this option value.

**name** `string` *required*

Human-readable label for this option value.

**value** *required*

Unique identifier for this option value.

## SessionConfigSelectOptions

Possible values for a session configuration option.

**Type:** Union

**Ungrouped** `array`

A flat list of options with no grouping.

**Grouped** `array`

A list of options grouped under headers.

## SessionConfigValueId

Unique identifier for a session configuration option value.

**Type:** `string`

## SessionDeleteCapabilities

Capabilities for the `session/delete` method.

Supplying `\{\}` means the agent supports deleting sessions from `session/list`.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## SessionId

A unique identifier for a conversation session between a client and agent.

Sessions maintain their own context, conversation history, and state,
allowing multiple independent interactions with the same agent.

See protocol docs: [Session ID](https://agentclientprotocol.com/protocol/v2/session-setup.md#session-id)

**Type:** `string`

## SessionInfo

Information about a session returned by session/list

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**additionalDirectories**

Additional workspace roots reported for this session. Each path must be absolute.

When present, this is the complete ordered additional-root list reported
by the Agent. Omitted and empty values are equivalent: the response
reports no additional roots.

**cwd** *required*

The working directory for this session. Must be an absolute path.

**sessionId** *required*

Unique identifier for the session

**title** `string | null`

Human-readable title for the session

**updatedAt** `string | null`

RFC 3339 timestamp of last activity.

* Format: `date-time`

## SessionInfoUpdate

Update to session metadata. All fields are optional to support partial updates.

Agents send this notification to update session information like title or custom metadata.
This allows clients to display dynamic session names and track session state changes.

Omitted fields leave the existing session info unchanged. `null` clears the
corresponding value. A concrete `_meta` object patches the stored metadata by
top-level key.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**title** `string | null`

Human-readable title for the session. Set to null to clear.

**updatedAt** `string | null`

RFC 3339 timestamp of last activity. Set to null to clear.

* Format: `date-time`

## SessionListCursor

An opaque cursor used to paginate `session/list` results.

**Type:** `string`

## SessionUpdate

Different types of updates that can be sent while a session exists.

These updates report messages, progress, and other session activity.

See protocol docs: [Agent Reports Output](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#3-agent-reports-output)

**Type:** Union

**user\_message\_chunk** `object`

A chunk of the user's message being streamed.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. This field is chunk-scoped.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**content** *required*

A single item of content

**messageId** *required*

A unique identifier for the message this chunk belongs to.

All chunks belonging to the same message share the same `messageId`.
A change in `messageId` indicates a new message has started.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"user_message_chunk"`.

**user\_message** `object`

A user message has been created or updated.

Agents can send this when they accept or replay a user message. When a
client receives another `user_message` update with the same `messageId`,
fields in the new update patch the previous fields for that message.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**content**

Complete replacement content for this message.

**messageId** *required*

A unique identifier for the message.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"user_message"`.

**agent\_message\_chunk** `object`

A chunk of the agent's response being streamed.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. This field is chunk-scoped.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**content** *required*

A single item of content

**messageId** *required*

A unique identifier for the message this chunk belongs to.

All chunks belonging to the same message share the same `messageId`.
A change in `messageId` indicates a new message has started.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"agent_message_chunk"`.

**agent\_message** `object`

An agent message has been created or updated.

Agents can send this in addition to streamed chunks. When a client
receives another `agent_message` update with the same `messageId`,
fields in the new update patch the previous fields for that message.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**content**

Complete replacement content for this message.

**messageId** *required*

A unique identifier for the message.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"agent_message"`.

**agent\_thought\_chunk** `object`

A chunk of the agent's internal reasoning being streamed.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. This field is chunk-scoped.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**content** *required*

A single item of content

**messageId** *required*

A unique identifier for the message this chunk belongs to.

All chunks belonging to the same message share the same `messageId`.
A change in `messageId` indicates a new message has started.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"agent_thought_chunk"`.

**agent\_thought** `object`

An agent thought or reasoning message has been created or updated.

Agents can send this in addition to streamed chunks. When a client
receives another `agent_thought` update with the same `messageId`,
fields in the new update patch the previous fields for that message.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**content**

Complete replacement content for this thought message.

**messageId** *required*

A unique identifier for the thought message.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"agent_thought"`.

**state\_update** `object`

A snapshot of the session's aggregate foreground activity.

**Properties**

**sessionUpdate** `string` *required*

The discriminator value. Must be `"state_update"`.

**Alternatives (`anyOf`):**

**running** `object`

Foreground work is in progress.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**state** `string` *required*

The discriminator value. Must be `"running"`.

**idle** `object`

No foreground work is active. Background activity may continue.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**state** `string` *required*

The discriminator value. Must be `"idle"`.

**stopReason** `string | null`

Why foreground work stopped. The value selects one of this type's variants, which may add fields of their own.

Optional. Omitted or `null` both mean the agent is not reporting a stop reason; a malformed value is treated the same way.

See protocol docs: [Stop Reasons](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#stop-reasons)

**Alternatives (`anyOf`):**

**end\_turn** `object`

The active work ended successfully.
Includes locally handled commands that required no model call.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"end_turn"`.

**max\_tokens** `object`

The active work ended because the agent reached the maximum number of tokens.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"max_tokens"`.

**max\_turn\_requests** `object`

The active work ended because the agent reached the maximum number of
allowed agent requests before returning idle.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"max_turn_requests"`.

**refusal** `object`

The active work ended because the agent refused to continue. The user
prompt and everything that comes after it won't be included in the next
prompt, so this should be reflected in the UI.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"refusal"`.

**cancelled** `object`

Active session work was cancelled by the client via `session/cancel`.

Agents MUST report this stop reason on an idle `state_update` when
cancellation ends active foreground work, even if aborting causes
exceptions. Agents MUST catch these errors and report `cancelled`, not
`error`.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"cancelled"`.

**error** `object`

The active work ended because something failed.

This includes pre-insertion foreground work. A prompt failure before
insertion also requires an error response to `session/prompt`; after
insertion, the prompt's response remains successful.

**Properties**

**error**

The failure, as a JSON-RPC error object.

Optional. Omitted or `null` both mean the agent is not reporting failure details.
Agents SHOULD include it.

**stopReason** `string` *required*

The discriminator value. Must be `"error"`.

**other** `object`

Custom or future stop reason.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**Properties**

**stopReason** `string` *required*

Custom or future stop reason.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**none** `object`

No stop reason: `stopReason` is omitted or `null`.

**Properties**

**stopReason** `null`

**requires\_action** `object`

Foreground work is blocked on user action.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**state** `string` *required*

The discriminator value. Must be `"requires_action"`.

**other** `object`

Custom or future session state.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**Properties**

**state** `string` *required*

Custom or future session state.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**tool\_call\_content\_chunk** `object`

A chunk of tool-call content being streamed.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. This field is chunk-scoped.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**content** *required*

A single item of content produced by the tool call.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"tool_call_content_chunk"`.

**toolCallId** *required*

The ID of the tool call this content belongs to.

**tool\_call\_update** `object`

A tool call has been created or updated.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**content**

Content produced by the tool call.

**kind**

The category of tool being invoked.
Helps clients choose appropriate icons and UI treatment.

**locations**

File locations affected by this tool call.
Enables "follow-along" features in clients.

**name** `string | null`

Programmatic name of the tool being invoked.

This field is optional and has patch semantics. Omission means no
change, `null` clears the name, and a string replaces it. For a tool
call ID the client has not seen before, omission or `null` means that no
tool name is available.

**rawInput** `object`

Raw input parameters sent to the tool.

**rawOutput** `object`

Raw output returned by the tool.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"tool_call_update"`.

**status**

Current execution status of the tool call.

**title** `string | null`

Human-readable title describing what the tool is doing.

**toolCallId** *required*

Unique identifier for this tool call within the session.

**terminal\_update** `object`

An agent-owned terminal has been created or updated.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**command** `string | null`

The command being run.

**cwd**

The absolute working directory of the command.

**exitStatus**

Exit information. A concrete object marks the terminal as exited.

**output**

An authoritative replacement snapshot of terminal output bytes.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"terminal_update"`.

**terminalId** *required*

Unique identifier for this terminal within the session.

**terminal\_output\_chunk** `object`

A chunk of bytes appended to an agent-owned terminal's output.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. This field is chunk-scoped. Omitted and `null` are
equivalent and mean no chunk metadata was provided.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**data** `string` *required*

Independently base64-encoded terminal output bytes.

* Content encoding: `base64`

**sessionUpdate** `string` *required*

The discriminator value. Must be `"terminal_output_chunk"`.

**terminalId** *required*

The terminal receiving these bytes.

**plan\_update** `object`

A content update for a plan identified by ID.
See protocol docs: [Agent Plan](https://agentclientprotocol.com/protocol/v2/agent-plan.md)

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**plan** *required*

The updated plan content.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"plan_update"`.

**available\_commands\_update** `object`

Available commands are ready or have changed

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**availableCommands** *required*

Commands the agent can execute.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"available_commands_update"`.

**config\_option\_update** `object`

Session configuration options have been updated.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**configOptions** *required*

The full set of configuration options and their current values.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"config_option_update"`.

**session\_info\_update** `object`

Session metadata has been updated (title, timestamps, custom metadata)

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**sessionUpdate** `string` *required*

The discriminator value. Must be `"session_info_update"`.

**title** `string | null`

Human-readable title for the session. Set to null to clear.

**updatedAt** `string | null`

RFC 3339 timestamp of last activity. Set to null to clear.

* Format: `date-time`

**usage\_update** `object`

Context window and cost update for the session.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**cost**

Cumulative session cost (optional).

**sessionUpdate** `string` *required*

The discriminator value. Must be `"usage_update"`.

**size** `uint64` *required*

Total context window size in tokens.

* Minimum: `0`

**used** `uint64` *required*

Tokens currently in context.

* Minimum: `0`

**notice** `object`

Information for the user that is not part of session history.

No Client capability is required. Clients that do not understand or
present notices may ignore them.

**Properties**

**\_meta** `object | null`

Metadata scoped to this notice.

Omitted and `null` are equivalent and mean no metadata was supplied.

**description** `string | null`

Optional plain-text detail or guidance.

Omitted and `null` are equivalent and mean no description was supplied.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"notice"`.

**severity** *required*

Presentation severity hint.

**title** `string` *required*

Required non-empty plain-text title that can stand alone.

* Min length: `1`

**compaction\_update** `object`

A context compaction has been created or updated.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**compactionId** *required*

The Agent-owned ID of this compaction, unique within the session.

**error** `string | null`

Human-readable error details for the compaction.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"compaction_update"`.

**status** *required*

Current lifecycle status.

**summary**

Complete replacement user-displayable summary content for the compaction.

**compaction\_summary\_chunk** `object`

A content block appended to a context compaction's retained summary.

**Properties**

**\_meta** `object | null`

Metadata scoped to this chunk. Omission and `null` both mean absent.

**compactionId** *required*

ID of the compaction whose summary receives this content.

**content** *required*

One content block to append.

**sessionUpdate** `string` *required*

The discriminator value. Must be `"compaction_summary_chunk"`.

**other** `object`

Custom or future session update.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Receivers that do not understand this update type should preserve the
raw payload when storing, replaying, proxying, or forwarding session
history, and otherwise ignore it or display it generically.

**Properties**

**sessionUpdate** `string` *required*

Custom or future session update type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## StateUpdate

A snapshot of the session's aggregate foreground activity.

Foreground work is the agent's active response or workflow in the session,
including model processing, tool execution, and waiting for user action needed
to continue that work. It can start with a prompt or be agent-initiated, for
example to pursue an ongoing goal or follow up on a completed background task.
Either way, the agent MUST report `running` when foreground work starts,
or `requires_action` if it starts blocked on user action, and `idle` when it
ends. The agent SHOULD include a stop reason on that idle update.
Agent-initiated work does not require a prompt request or a synthetic user
message.

`running` may precede user-message insertion, for example during a foreground
hook. It is not acknowledgment of insertion, and rejecting a prompt does not
itself end foreground work.

Background activity can continue and emit other `session/update` notifications
while `idle`. Those notifications, including a detached task's progress or
completion, do not by themselves change this state. A permission request only
warrants `requires_action` when foreground work is blocked on user action.

The agent SHOULD report `requires_action` when the foreground workflow as a
whole cannot progress without user action, including permissions or elicitations.
Once reported, it MUST report `running` when progress resumes, or `idle` when
work ends without resuming.
If other foreground work can progress, the state remains `running`. Resolving
one of several requests does not itself change the state. Agents SHOULD ignore
responses for work that has already ended rather than use them to resume it.

A new session defaults to idle until a state update reports otherwise.
Resume MUST send a current-state snapshot after any replay and before its
response. The snapshot reports foreground state after resuming.
The response alone does not imply idle.
Repeated snapshots are idempotent, not additional work, completions, or usage.
A repeated state may carry updated information without another state transition.
The agent MUST report `idle` when no foreground activity remains. Completing
an individual activity while other foreground work continues does not require
an idle boundary. Local commands use the same lifecycle even without model work.

See protocol docs: [Session States](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#session-states)

**Type:** Union

**running** `object`

Foreground work is in progress.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**state** `string` *required*

The discriminator value. Must be `"running"`.

**idle** `object`

No foreground work is active. Background activity may continue.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**state** `string` *required*

The discriminator value. Must be `"idle"`.

**stopReason** `string | null`

Why foreground work stopped. The value selects one of this type's variants, which may add fields of their own.

Optional. Omitted or `null` both mean the agent is not reporting a stop reason; a malformed value is treated the same way.

See protocol docs: [Stop Reasons](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#stop-reasons)

**Alternatives (`anyOf`):**

**end\_turn** `object`

The active work ended successfully.
Includes locally handled commands that required no model call.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"end_turn"`.

**max\_tokens** `object`

The active work ended because the agent reached the maximum number of tokens.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"max_tokens"`.

**max\_turn\_requests** `object`

The active work ended because the agent reached the maximum number of
allowed agent requests before returning idle.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"max_turn_requests"`.

**refusal** `object`

The active work ended because the agent refused to continue. The user
prompt and everything that comes after it won't be included in the next
prompt, so this should be reflected in the UI.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"refusal"`.

**cancelled** `object`

Active session work was cancelled by the client via `session/cancel`.

Agents MUST report this stop reason on an idle `state_update` when
cancellation ends active foreground work, even if aborting causes
exceptions. Agents MUST catch these errors and report `cancelled`, not
`error`.

**Properties**

**stopReason** `string` *required*

The discriminator value. Must be `"cancelled"`.

**error** `object`

The active work ended because something failed.

This includes pre-insertion foreground work. A prompt failure before
insertion also requires an error response to `session/prompt`; after
insertion, the prompt's response remains successful.

**Properties**

**error**

The failure, as a JSON-RPC error object.

Optional. Omitted or `null` both mean the agent is not reporting failure details.
Agents SHOULD include it.

**stopReason** `string` *required*

The discriminator value. Must be `"error"`.

**other** `object`

Custom or future stop reason.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**Properties**

**stopReason** `string` *required*

Custom or future stop reason.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**none** `object`

No stop reason: `stopReason` is omitted or `null`.

**Properties**

**stopReason** `null`

**requires\_action** `object`

Foreground work is blocked on user action.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**state** `string` *required*

The discriminator value. Must be `"requires_action"`.

**other** `object`

Custom or future session state.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

**Properties**

**state** `string` *required*

Custom or future session state.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## StringFormat

String format types for string properties in elicitation schemas.

**Type:** Union

**email** `string`

Email address format.

**uri** `string`

URI format.

**date** `string`

Date format (YYYY-MM-DD).

**date-time** `string`

Date-time format (RFC 3339).

**other** `string`

Custom or future string format.

Unknown formats are preserved. Implementations that do not understand a
format should treat it as an annotation rather than rejecting the schema.

## StringMultiSelectItems

String item schema for multi-select enum properties.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**enum** *required*

Allowed enum values. Must contain at least one value.

## StringPropertySchema

Schema for string properties in an elicitation form.

When `enum` or `oneOf` is set, this represents a single-select enum
with `"type": "string"`.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**default** `string | null`

Default value.

Optional. Omitted and `null` are equivalent and mean no default value is provided.

**description** `string | null`

Human-readable description.

Optional. Omitted and `null` are equivalent and mean no description is provided.

**enum**

Enum values for untitled single-select enums.
Must contain at least one value when present.
Optional. Omitted and `null` are equivalent and mean no untitled single-select choices are
declared by `enum`.

**format**

String format.

Optional. Omitted and `null` are equivalent and mean there is no format constraint.

**maxLength** `integer | null`

Maximum string length.

Optional. Omitted and `null` are equivalent and mean there is no maximum length constraint.

* Minimum: `0`

**minLength** `integer | null`

Minimum string length.

Optional. Omitted and `null` are equivalent and mean there is no minimum length constraint.

* Minimum: `0`

**oneOf**

Titled enum options for titled single-select enums.
Must contain at least one option when present.
Optional. Omitted and `null` are equivalent and mean no titled single-select choices are
declared by `oneOf`.

**pattern** `string | null`

Pattern the string must match.

Optional. Omitted and `null` are equivalent and mean there is no pattern constraint.

* Format: `regex`

**title** `string | null`

Optional title for the property.

Optional. Omitted and `null` are equivalent and mean no title is provided.

## Terminal

A display-only reference to an agent-owned terminal.

Terminal state and output are delivered separately through
`TerminalUpdate` and `TerminalOutputChunk`.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. This metadata is scoped to the content reference. Omitted
and `null` are equivalent and mean no item metadata was provided.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**terminalId** *required*

The ID of the terminal to display.

## TerminalAuthCapabilities

Capabilities for terminal authentication methods.

Supplying `\{\}` means the client can reproduce the configured agent
invocation in an interactive terminal and supports terminal authentication
methods.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

## TerminalExitStatus

Exit information for an agent-owned terminal.

The presence of this object marks the terminal as exited, even when neither
an exit code nor a signal is known.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. This metadata is scoped to the exit information. Omitted
and `null` are equivalent and mean no exit metadata was provided.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**exitCode** `integer | null`

Process exit code, when known. Omitted and `null` are equivalent.

* Minimum: `0`

**signal** `string | null`

Signal that terminated the process, when known.

Agents should use the conventional platform signal name. POSIX examples
include `SIGTERM`, `SIGKILL`, and `SIGINT`. Other platforms may use a
platform-specific name. Omitted and `null` are equivalent.

## TerminalId

Unique identifier for an agent-owned terminal within a session.

**Type:** `string`

## TerminalOutput

An authoritative replacement snapshot of terminal output bytes.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. This metadata is scoped to the replacement snapshot. Omitted
and `null` are equivalent and mean no snapshot metadata was provided.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**data** `string` *required*

Base64-encoded replacement terminal output bytes.

* Content encoding: `base64`

## TerminalOutputChunk

A chunk of bytes appended to an agent-owned terminal's output.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. This field is chunk-scoped. Omitted and `null` are
equivalent and mean no chunk metadata was provided.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**data** `string` *required*

Independently base64-encoded terminal output bytes.

* Content encoding: `base64`

**terminalId** *required*

The terminal receiving these bytes.

## TerminalUpdate

An upsert for the stored state of an agent-owned terminal.

Only `TerminalUpdate::terminal_id` is required. Other fields have patch
semantics: omitted fields leave the stored value unchanged, `null` clears
it, and concrete values replace it. A concrete `_meta` object instead
patches the stored metadata by top-level key. When the terminal ID is new,
omitted fields start unknown.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**command** `string | null`

The command being run.

**cwd**

The absolute working directory of the command.

**exitStatus**

Exit information. A concrete object marks the terminal as exited.

**output**

An authoritative replacement snapshot of terminal output bytes.

**terminalId** *required*

Unique identifier for this terminal within the session.

## TextCommandInput

All text that was typed after the command name is provided as input.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**hint** `string` *required*

A hint to display when the input hasn't been provided yet

## TextContent

Text provided to or from an LLM.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**annotations**

Optional annotations that help clients decide how to display or route this content.

**text** `string` *required*

Text payload carried by this content block.

## TextResourceContents

Text-based resource contents.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**mimeType**

MIME type describing the encoded media payload.

**text** `string` *required*

Text payload carried by this content block.

**uri** `string` *required*

URI associated with this resource or media payload.

* Format: `uri`

## TitledMultiSelectItems

Items definition for titled multi-select enum properties.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

Optional. Omitted and `null` are equivalent and mean no metadata.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**anyOf** *required*

Titled enum options. Must contain at least one option.

## ToolCallContent

Content produced by a tool call.

Tool calls can produce different types of content including standard
content blocks (text, images), file diffs, or display-only terminals.

See protocol docs: [Content](https://agentclientprotocol.com/protocol/v2/tool-calls.md#content)

**Type:** Union

**content** `object`

Standard content block (text, images, resources).

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**content** *required*

The actual content block.

**type** `string` *required*

The discriminator value. Must be `"content"`.

**diff** `object`

File modification shown as a diff.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**changes** *required*

Structured file changes described by this diff.

Clients can use this field without parsing patch text to determine affected paths.

**patch**

Renderable patch text for some or all of the structured changes.

Agents SHOULD provide patch text whenever feasible. Omitted or `null`
means no renderable patch text was provided.

**type** `string` *required*

The discriminator value. Must be `"diff"`.

**terminal** `object`

A display-only reference to an agent-owned terminal.

**Properties**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. This metadata is scoped to the content reference. Omitted
and `null` are equivalent and mean no item metadata was provided.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**terminalId** *required*

The ID of the terminal to display.

**type** `string` *required*

The discriminator value. Must be `"terminal"`.

**other** `object`

Custom or future tool call content.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

Receivers that do not understand this content type should preserve the
raw payload when storing, replaying, proxying, or forwarding tool call
output, and otherwise ignore it or display it generically.

**Properties**

**type** `string` *required*

Custom or future tool call content type.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## ToolCallContentChunk

A streamed item of tool-call content.

Tool-call content chunks append one `ToolCallContent` item to the current
content for the matching `ToolCallId`. Agents can use
`ToolCallUpdate::content` when they need to replace the whole content
collection instead.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys. This field is chunk-scoped.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**content** *required*

A single item of content produced by the tool call.

**toolCallId** *required*

The ID of the tool call this content belongs to.

## ToolCallId

Unique identifier for a tool call within a session.

**Type:** `string`

## ToolCallLocation

A file location being accessed or modified by a tool.

Enables clients to implement "follow-along" features that track
which files the agent is working with in real-time.

See protocol docs: [Following the Agent](https://agentclientprotocol.com/protocol/v2/tool-calls.md#following-the-agent)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**line** `integer | null`

Optional line number within the file.

* Minimum: `0`

**path** *required*

The absolute file path being accessed or modified.

## ToolCallPermissionSubject

Permission request details for a tool call.

**Type:** Object

**Properties:**

**toolCall** *required*

Details about the tool call requiring permission.

## ToolCallStatus

Execution status of a tool call.

Tool calls progress through different statuses during their lifecycle.

See protocol docs: [Status](https://agentclientprotocol.com/protocol/v2/tool-calls.md#status)

**Type:** Union

**pending** `string`

The tool call hasn't started running yet because the input is either streaming
or we're awaiting approval.

**in\_progress** `string`

The tool call is currently running.

**completed** `string`

The tool call completed successfully.

**failed** `string`

The tool call failed with an error.

**cancelled** `string`

The tool call was cancelled before it completed.

**other** `string`

Custom or future tool call status.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## ToolCallUpdate

Represents an upsert for a tool call that the language model has requested.

Tool calls are actions that the agent executes on behalf of the language model,
such as reading files, executing code, or fetching data from external sources.

Only `ToolCallUpdate::tool_call_id` is required. Other fields have patch semantics:
omitted fields leave the existing tool call value unchanged, `null` clears or
unsets the value, and concrete values replace the previous value. For
collection fields, concrete arrays replace the previous collection, and both
`null` and `[]` clear the collection. A concrete `_meta` object instead
patches the stored metadata by top-level key. When a client receives a tool
call ID it has not seen before, omitted fields use client defaults.

See protocol docs: [Tool Calls](https://agentclientprotocol.com/protocol/v2/tool-calls.md)

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**content**

Content produced by the tool call.

**kind**

The category of tool being invoked.
Helps clients choose appropriate icons and UI treatment.

**locations**

File locations affected by this tool call.
Enables "follow-along" features in clients.

**name** `string | null`

Programmatic name of the tool being invoked.

This field is optional and has patch semantics. Omission means no
change, `null` clears the name, and a string replaces it. For a tool
call ID the client has not seen before, omission or `null` means that no
tool name is available.

**rawInput** `object`

Raw input parameters sent to the tool.

**rawOutput** `object`

Raw output returned by the tool.

**status**

Current execution status of the tool call.

**title** `string | null`

Human-readable title describing what the tool is doing.

**toolCallId** *required*

Unique identifier for this tool call within the session.

## ToolKind

Categories of tools that can be invoked.

Tool kinds help clients choose appropriate icons and optimize how they
display tool execution progress.

See protocol docs: [Creating](https://agentclientprotocol.com/protocol/v2/tool-calls.md#creating)

**Type:** Union

**read** `string`

Reading files or data.

**edit** `string`

Modifying files or content.

**delete** `string`

Removing files or data.

**move** `string`

Moving or renaming files.

**search** `string`

Searching for information.

**execute** `string`

Running commands or code.

**think** `string`

Internal reasoning or planning.

**fetch** `string`

Retrieving external data.

**switch\_mode** `string`

Switching the current session mode.

**other** `string`

Other tool types (default).

**unknown** `string`

Custom or future tool kind.

Values beginning with `_` are reserved for implementation-specific
extensions. Unknown values that do not begin with `_` are reserved for
future ACP variants.

## UsageUpdate

Context window and cost update for a session.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Implementations MUST NOT make assumptions about values at
these keys.

See protocol docs: [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md)

**cost**

Cumulative session cost (optional).

**size** `uint64` *required*

Total context window size in tokens.

* Minimum: `0`

**used** `uint64` *required*

Tokens currently in context.

* Minimum: `0`

## UserMessage

A user message upsert.

Only `UserMessage::message_id` is required. `content` has patch semantics:
an omitted field leaves existing message content unchanged, `null` clears the
value, and a concrete array replaces the previous value. For a new
`messageId`, omitted fields use client defaults. `content` is replaced as a
whole array; send `[]` or `null` to clear it.

Message updates and chunks are applied in the order they are received. When
a `user_message` update includes `content`, that array replaces any content
previously accumulated for the message, including content from earlier
chunks. Later chunks with the same `messageId` append to the current
content.

**Type:** Object

**Properties:**

**\_meta** `object | null`

The \_meta property is reserved by ACP to allow clients and agents to attach additional
metadata to their interactions. Omitted leaves the stored metadata unchanged; `null`
clears it. An object patches the stored metadata by top-level key: keys it omits are
unchanged, a key set to `null` is removed, and any other value replaces that key's
stored value without merging nested objects. Beyond this patch rule, implementations
MUST NOT make assumptions about values at these keys.

See protocol docs: [Metadata Patches](https://agentclientprotocol.com/protocol/v2/extensibility.md#metadata-patches)

**content**

Complete replacement content for this message.

**messageId** *required*

A unique identifier for the message.


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.