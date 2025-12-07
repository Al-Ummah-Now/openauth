# Code Style and Conventions

## Formatting
- **No semicolons** (configured in .prettierrc)
- **Double quotes** for strings
- **TypeScript strict mode**
- **ES Modules** (type: "module" in package.json)

## Naming Conventions
- **PascalCase**: Types, Interfaces, Classes
- **camelCase**: Functions, variables, methods
- **UPPER_SNAKE_CASE**: Constants

## TypeScript Patterns
- Interfaces for public contracts (e.g., `Provider`, `OidcConfig`)
- Type inference where possible
- Generic types for flexible provider implementations
- Utility types like `Prettify<T>`, `Omit<T, K>`

## Provider Pattern
```typescript
export function ProviderName(config: ProviderConfig): Provider<ReturnType> {
  return {
    type: "provider-name",
    init(routes, ctx) {
      routes.get("/authorize", async (c) => { ... })
      routes.post("/callback", async (c) => { ... })
    },
    client?: async (input) => { ... }  // Optional for client_credentials
  }
}
```

## Hono Patterns
- Route handlers with Context (`c`)
- Middleware using `app.use()`
- Error handling with `app.onError()`
