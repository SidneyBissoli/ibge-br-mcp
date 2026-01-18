# Contributing to IBGE MCP Server

Thank you for your interest in contributing to the IBGE MCP Server! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Adding New Tools](#adding-new-tools)
- [Testing](#testing)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all experience levels.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR-USERNAME/ibge-br-mcp.git`
3. Create a feature branch: `git checkout -b feature/your-feature-name`
4. Make your changes
5. Submit a pull request

## Development Setup

### Prerequisites

- Node.js 18.0.0 or higher
- npm

### Installation

```bash
cd ibge-br-mcp
npm install
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run watch` | Watch mode for development |
| `npm run dev` | Build and run the server |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run inspector` | Open MCP Inspector |

## Project Structure

```
ibge-br-mcp/
├── src/
│   ├── index.ts          # Main MCP server and tool registration
│   ├── types.ts          # TypeScript type definitions
│   ├── cache.ts          # In-memory caching system
│   ├── metrics.ts        # Performance metrics tracking
│   ├── errors.ts         # Error handling utilities
│   ├── validation.ts     # Input validation functions
│   ├── retry.ts          # Retry mechanism for network calls
│   ├── config.ts         # Configuration and constants
│   ├── tools/            # Individual tool implementations
│   │   ├── estados.ts
│   │   ├── municipios.ts
│   │   ├── sidra.ts
│   │   └── ...
│   └── utils/            # Utility functions
│       ├── formatters.ts
│       └── index.ts
├── tests/                # Test files
│   ├── validation.test.ts
│   ├── cache.test.ts
│   └── ...
├── dist/                 # Compiled JavaScript (generated)
└── package.json
```

## Adding New Tools

### Step 1: Create the Tool File

Create a new file in `src/tools/` with the following structure:

```typescript
import { z } from "zod";
import { IBGE_API } from "../types.js";
import { cacheKey, CACHE_TTL, cachedFetch } from "../cache.js";
import { withMetrics } from "../metrics.js";
import { createMarkdownTable } from "../utils/index.js";
import { parseHttpError, ValidationErrors } from "../errors.js";

// Define the input schema using Zod
export const myToolSchema = z.object({
  param1: z.string().describe("Description of param1"),
  param2: z.number().optional().default(10).describe("Description of param2"),
});

export type MyToolInput = z.infer<typeof myToolSchema>;

// Implement the tool function
export async function myTool(input: MyToolInput): Promise<string> {
  return withMetrics("my_tool", "api_category", async () => {
    try {
      // Your implementation here
      const url = `${IBGE_API.LOCALIDADES}/...`;
      const key = cacheKey(url);
      const data = await cachedFetch<YourType>(url, key, CACHE_TTL.MEDIUM);

      // Format and return results
      return formatResults(data);
    } catch (error) {
      if (error instanceof Error) {
        return parseHttpError(error, "my_tool", { param1: input.param1 });
      }
      return ValidationErrors.emptyResult("my_tool");
    }
  });
}

// Export tool definition
export const myToolTool = {
  name: "my_tool",
  description: `Description of your tool in English.

Features:
- Feature 1
- Feature 2

Examples:
- Example usage 1
- Example usage 2`,
  inputSchema: myToolSchema,
  handler: myTool,
};
```

### Step 2: Export from Tools Index

Add your export to `src/tools/index.ts`:

```typescript
export * from "./my-tool.js";
```

### Step 3: Register in Main Server

Register the tool in `src/index.ts`:

```typescript
import { myToolSchema, myTool } from "./tools/my-tool.js";

// In the tools section:
server.tool(
  "my_tool",
  `Tool description in English...`,
  myToolSchema.shape,
  async (args) => {
    const result = await myTool(args);
    return { content: [{ type: "text", text: result }] };
  }
);
```

### Step 4: Add Tests

Create a test file `tests/my-tool.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { myToolSchema } from "../src/tools/my-tool.js";

describe("myToolSchema", () => {
  it("should accept valid input", () => {
    const result = myToolSchema.safeParse({ param1: "value" });
    expect(result.success).toBe(true);
  });

  // Add more tests...
});
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Writing Tests

- Place test files in the `tests/` directory
- Name test files with `.test.ts` suffix
- Use descriptive test names
- Test both valid and invalid inputs
- Mock external API calls for integration tests

## Code Style

### ESLint & Prettier

The project uses ESLint and Prettier for code quality:

```bash
# Check for linting issues
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format code
npm run format
```

### Style Guidelines

- Use TypeScript for all code
- Use ES modules (`.js` extension in imports)
- Prefer `const` over `let`
- Use descriptive variable and function names
- Add JSDoc comments for public functions
- Keep functions focused and small
- Use centralized utilities instead of inline implementations

### Tool Description Guidelines

- Write tool descriptions in English
- Include a brief summary
- List key features
- Provide usage examples
- Be concise but informative

## Submitting Changes

### Pull Request Process

1. Ensure all tests pass: `npm test`
2. Ensure no linting errors: `npm run lint`
3. Update documentation if needed
4. Add entries to CHANGELOG.md
5. Create a pull request with a clear description

### Commit Messages

Use clear, descriptive commit messages:

```
Add new tool for X functionality

- Implement X feature
- Add tests for X
- Update documentation
```

### Review Process

- All changes require review before merging
- Address review feedback promptly
- Keep discussions constructive

## Questions?

If you have questions, please:

1. Check existing issues
2. Read the documentation
3. Open a new issue with your question

Thank you for contributing!
