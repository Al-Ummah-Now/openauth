# Task Completion Checklist

## Before Completing a Task

1. **Code Quality**
   - No TypeScript errors
   - Code follows project style (no semicolons, double quotes)
   - Follows existing patterns in codebase

2. **Testing**
   - Run `bun test` in packages/openauth
   - Add tests for new functionality

3. **Build Verification**
   - Run `bun run --filter="@openauthjs/openauth" build`
   - Ensure no build errors

4. **Documentation**
   - Update types/interfaces with JSDoc comments
   - Update exports in index.ts if adding public APIs

5. **Security Considerations**
   - Validate inputs
   - Use parameterized queries for SQL
   - Encrypt secrets at rest
   - No secrets in logs
