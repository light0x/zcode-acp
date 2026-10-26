> ## Documentation Index
> Fetch the complete documentation index at: https://agentclientprotocol.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Content

> Understanding content blocks in the Agent Client Protocol

Content blocks represent displayable information that flows through the Agent Client Protocol. They provide a structured way to handle various types of user-facing content—whether it's text from language models, images for analysis, or embedded resources for context.

Content blocks appear in:

* User prompts sent via [`session/prompt`](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle#1-user-message)
* Language model output reported through [`session/update`](https://agentclientprotocol.com/protocol/v2/prompt-lifecycle#3-agent-reports-output) notifications as message updates or streamed chunks
* Progress updates and results from [tool calls](https://agentclientprotocol.com/protocol/v2/tool-calls.md), including streamed tool-call content chunks

## Content Types

The Agent Client Protocol uses the same `ContentBlock` structure as the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/specification/2026-07-28/schema#contentblock).

This design choice enables Agents to seamlessly forward content from MCP tool outputs without transformation.

Content block `type` values can be custom or future variants when the receiver can preserve or display them generically. Custom content block types **MUST** begin with `_`. Unknown non-underscore content block types are reserved for future ACP variants.

### Text Content

Plain text messages form the foundation of most interactions.

```json theme={null}
{
  "type": "text",
  "text": "What's the weather like today?"
}
```

All Agents **MUST** support text content blocks when included in prompts.

**text** `string` *required*

The text content to display

**annotations** `Annotations`

Optional metadata about how the content should be used or displayed. [Learn
more](https://modelcontextprotocol.io/specification/2026-07-28/schema#annotations).

### Image Content&#x20;

Images can be included for visual context or analysis.

```json theme={null}
{
  "type": "image",
  "mimeType": "image/png",
  "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB..."
}
```

&#x20;Requires the `image` [prompt
capability](https://agentclientprotocol.com/protocol/v2/initialization.md#prompt-capabilities) when included in
prompts.

**data** `string` *required*

Base64-encoded image data

**mimeType** `string` *required*

The MIME type of the image (e.g., "image/png", "image/jpeg")

**uri** `string`

Optional URI reference for the image source

**annotations** `Annotations`

Optional metadata about how the content should be used or displayed. [Learn
more](https://modelcontextprotocol.io/specification/2026-07-28/schema#annotations).

### Audio Content&#x20;

Audio data for transcription or analysis.

```json theme={null}
{
  "type": "audio",
  "mimeType": "audio/wav",
  "data": "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAAB..."
}
```

&#x20;Requires the `audio` [prompt
capability](https://agentclientprotocol.com/protocol/v2/initialization.md#prompt-capabilities) when included in
prompts.

**data** `string` *required*

Base64-encoded audio data

**mimeType** `string` *required*

The MIME type of the audio (e.g., "audio/wav", "audio/mp3")

**annotations** `Annotations`

Optional metadata about how the content should be used or displayed. [Learn
more](https://modelcontextprotocol.io/specification/2026-07-28/schema#annotations).

### Embedded Resource&#x20;

Complete resource contents embedded directly in the message.

```json theme={null}
{
  "type": "resource",
  "resource": {
    "uri": "file:///home/user/script.py",
    "mimeType": "text/x-python",
    "text": "def hello():\n    print('Hello, world!')"
  }
}
```

This is the preferred way to include context in prompts, such as when using @-mentions to reference files or other resources.

By embedding the content directly in the request, Clients can include context from sources that the Agent may not have direct access to.

&#x20;Requires the `embeddedContext` [prompt
capability](https://agentclientprotocol.com/protocol/v2/initialization.md#prompt-capabilities) when included in
prompts.

**resource** `EmbeddedResourceResource` *required*

The embedded resource contents, which can be either:

**Text Resource**

**uri** `string` *required*

The URI identifying the resource

**text** `string` *required*

The text content of the resource

**mimeType** `string`

Optional MIME type of the text content

**Blob Resource**

**uri** `string` *required*

The URI identifying the resource

**blob** `string` *required*

Base64-encoded binary data

**mimeType** `string`

Optional MIME type of the blob

**annotations** `Annotations`

Optional metadata about how the content should be used or displayed. [Learn
more](https://modelcontextprotocol.io/specification/2026-07-28/schema#annotations).

### Resource Link

References to resources that the Agent can access.

```json theme={null}
{
  "type": "resource_link",
  "uri": "file:///home/user/document.pdf",
  "name": "document.pdf",
  "mimeType": "application/pdf",
  "icons": [
    {
      "src": "https://example.com/icons/pdf.png",
      "mimeType": "image/png",
      "sizes": ["48x48"]
    }
  ],
  "size": 1024000
}
```

**uri** `string` *required*

The URI of the resource

**name** `string` *required*

A human-readable name for the resource

**mimeType** `string`

The MIME type of the resource

**title** `string`

Optional display title for the resource

**description** `string`

Optional description of the resource contents

**icons** `Icon[]`

Optional icons Clients can display for this resource. Each icon requires a
`src` URI and may include `mimeType`, `sizes`, and `theme`.

**size** `integer`

Optional size of the resource in bytes

**annotations** `Annotations`

Optional metadata about how the content should be used or displayed. [Learn
more](https://modelcontextprotocol.io/specification/2026-07-28/schema#annotations).


This documentation is built and hosted on [Mintlify](https://mintlify.com), a developer documentation platform.