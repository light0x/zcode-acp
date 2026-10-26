> ## Documentation Index
> Fetch the complete documentation index at: https://agentclientprotocol.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Overview

> How the Agent Client Protocol works

The Agent Client Protocol allows [Agents](#agent) and [Clients](#client) to communicate by exposing methods that each side can call and sending notifications to inform each other of events.

## Communication Model

The protocol follows the [JSON-RPC 2.0](https://www.jsonrpc.org/specification) specification with two types of messages:

* **Methods**: Request-response pairs that expect a result or error
* **Notifications**: One-way messages that don't expect a response

ACP follows JSON-RPC 2.0 batch behavior. See
[Transports](https://agentclientprotocol.com/protocol/v2/transports.md#json-rpc-batch-messages) for batch
handling requirements.

## Message Flow

A typical flow follows this pattern:

**1. Initialization Phase**

* Client → Agent: `initialize` to establish connection
* Client → Agent: `auth/login` if required by the Agent

**2. Session Setup - either:**

* Client → Agent: `session/new` to create a new session
* Client → Agent: `session/resume` to resume an existing session

**3. Prompt Lifecycle**

* Client → Agent: `session/prompt` to send user message
* Agent → Client: `session/prompt` response once the prompt is accepted
* Agent → Client: `session/update` notifications for accepted messages, state updates, and progress updates
* Agent → Client: Permission requests as needed
* Client → Agent: `session/cancel` to interrupt processing if needed
* Agent → Client: An idle `state_update` with a stop reason when foreground work ends, even if background activity continues

## Agent

Agents are programs that use generative AI to autonomously modify code. They typically run as subprocesses of the Client.

### Baseline Methods

Some baseline methods belong to optional surfaces. An Agent that returns one or more valid entries in `authMethods` **MUST** implement both `auth/login` and `auth/logout`. If `authMethods` is omitted or empty, Clients **MUST NOT** call either method.

**initialize**

[Negotiate versions and exchange capabilities.](https://agentclientprotocol.com/protocol/v2/initialization.md).

**auth/login**

Authenticate with the Agent (if required).

**auth/logout**

[End the current authenticated
state](https://agentclientprotocol.com/protocol/v2/authentication.md#logging-out).

**session/new**

[Create a new conversation
session](https://agentclientprotocol.com/protocol/v2/session-setup.md#creating-a-session).

**session/prompt**

[Send user prompts](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#1-user-message) to the
Agent.

**session/list**

[List known sessions](https://agentclientprotocol.com/protocol/v2/session-list.md).

**session/resume**

[Resume an existing session, optionally replaying
history](https://agentclientprotocol.com/protocol/v2/session-setup.md#resuming-sessions).

**session/close**

[Close an active session](https://agentclientprotocol.com/protocol/v2/session-setup.md#closing-active-sessions).

### Notifications

**session/cancel**

[Cancel ongoing operations](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#cancellation) (no
response expected).

## Client

Clients provide the interface between users and agents. They are typically code editors (IDEs, text editors) but can also be other UIs for interacting with agents. Clients manage the environment, handle user interactions, and control access to resources.

### Baseline Methods

**session/request\_permission**

[Request user authorization](https://agentclientprotocol.com/protocol/v2/tool-calls.md#requesting-permission)
for operations such as tool calls and commands.

### Optional Methods

**elicitation/create**

[Request structured information from the user](https://agentclientprotocol.com/protocol/v2/elicitation.md)
(requires the matching `elicitation` mode capability).

### Notifications

**elicitation/complete**

[Report completion of an out-of-band URL
interaction](https://agentclientprotocol.com/protocol/v2/elicitation.md#url-completion) (no response expected).

**session/update**

[Send session updates](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#3-agent-reports-output)
to inform the Client of changes (no response expected). This includes [message
updates and chunks](https://agentclientprotocol.com/protocol/v2/content.md), [tool calls, updates, and content
chunks](https://agentclientprotocol.com/protocol/v2/tool-calls.md), [display-only terminal state and output
chunks](https://agentclientprotocol.com/protocol/v2/tool-calls.md#display-only-terminals),
[plans](https://agentclientprotocol.com/protocol/v2/agent-plan.md), [available commands
updates](https://agentclientprotocol.com/protocol/v2/slash-commands.md#advertising-commands), [config option
updates](https://agentclientprotocol.com/protocol/v2/session-config-options.md#from-the-agent), [context
compactions](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#session-compaction), and
[user-facing notices](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md#session-notices).

## Argument requirements

* All file paths in the protocol **MUST** be absolute.
* Line numbers are 1-based

## Error Handling

All methods follow standard JSON-RPC 2.0 [error handling](https://www.jsonrpc.org/specification#error_object):

* Successful responses include a `result` field
* Errors include an `error` object with `code` and `message`
* Notifications never receive responses (success or error)

## Conventions

Unless explicitly defined otherwise in the schema, ACP-defined JSON object property keys use `camelCase`. String values carried by discriminator fields use `snake_case`. The JSON-RPC envelope fields (`jsonrpc`, `id`, `method`, `params`, `result`, and `error`) follow the JSON-RPC 2.0 specification.

Selected enum-like fields and tagged unions can define custom or future fallbacks. For those fields, `_`-prefixed values are reserved for implementation-specific extensions, while unknown non-underscore values are reserved for future ACP variants.

## Extensibility

The protocol provides built-in mechanisms for adding custom functionality while maintaining compatibility:

* Add custom data using `_meta` fields
* Create custom methods by prefixing their name with underscore (`_`)
* Advertise custom capabilities during initialization

Learn about [protocol extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md) to understand how to use these mechanisms.

## Next Steps

* Learn about [Initialization](https://agentclientprotocol.com/protocol/v2/initialization.md) to understand version and capability negotiation
* Understand [Session Setup](https://agentclientprotocol.com/protocol/v2/session-setup.md) for creating and loading sessions
* Review the [Prompt Lifecycle](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle.md)
* Explore [Extensibility](https://agentclientprotocol.com/protocol/v2/extensibility.md) to add custom features
* Check your agent implementation with the [Test Compatibility Kit](https://agentclientprotocol.com/libraries/testing.md)


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.