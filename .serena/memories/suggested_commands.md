# Development Commands

## Package Management
```bash
bun install          # Install dependencies
```

## Build
```bash
bun run --filter="@openauthjs/openauth" build    # Build the package
```

## Testing
```bash
cd packages/openauth && bun test                  # Run tests
```

## Release
```bash
bun run release      # Build and publish with changesets
```

## Git
```bash
git status
git diff
git add .
git commit -m "message"
git push
```

## Formatting
Uses Prettier automatically. No manual format command needed.
