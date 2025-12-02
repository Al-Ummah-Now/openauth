# Account Switcher Component

A comprehensive React component demonstrating OpenAuth's multi-account session management APIs.

## Features

- **List Accounts**: Displays all logged-in accounts in the current browser session
- **Switch Accounts**: Switch between accounts without re-authentication
- **Sign Out Single Account**: Remove individual accounts from the session
- **Sign Out All**: Clear all accounts and end the session
- **Add Account**: Redirect to OAuth flow to add another account

## Usage

```tsx
import { AccountSwitcher } from "./components/account-switcher"

export default function ProfilePage() {
  return (
    <div>
      <h1>User Profile</h1>
      <AccountSwitcher
        apiBaseUrl="/api"
        authorizeUrl="/authorize"
        onAccountSwitch={(userId) => {
          console.log("Switched to account:", userId)
        }}
        onSignOut={() => {
          console.log("All accounts signed out")
        }}
      />
    </div>
  )
}
```

## Props

| Prop              | Type                       | Default        | Description                                 |
| ----------------- | -------------------------- | -------------- | ------------------------------------------- |
| `apiBaseUrl`      | `string`                   | `"/api"`       | Base URL for session API endpoints          |
| `authorizeUrl`    | `string`                   | `"/authorize"` | OAuth authorization URL for adding accounts |
| `onAccountSwitch` | `(userId: string) => void` | -              | Callback when account is switched           |
| `onSignOut`       | `() => void`               | -              | Callback when user signs out                |

## API Endpoints

The component uses the following OpenAuth session management endpoints:

### GET /session/accounts

Lists all accounts in the current browser session.

**Response:**

```json
{
  "accounts": [
    {
      "userId": "user123",
      "isActive": true,
      "authenticatedAt": 1234567890000,
      "subjectType": "user",
      "clientId": "client123"
    }
  ]
}
```

### POST /session/switch

Switches the active account.

**Request:**

```json
{
  "userId": "user456"
}
```

**Response:**

```json
{
  "success": true
}
```

### DELETE /session/accounts/:userId

Signs out a specific account.

**Response:**

```json
{
  "success": true
}
```

### DELETE /session/all

Signs out all accounts.

**Response:**

```json
{
  "success": true
}
```

## State Management

The component maintains the following state:

- **accounts**: Array of account objects from the API
- **loading**: Current operation state (`idle`, `loading`, `switching`, `removing`, `adding`)
- **error**: Error message if any operation fails

## Error Handling

All API calls include comprehensive error handling:

- Network errors are caught and displayed to the user
- API error responses are parsed and shown
- Failed operations reset the loading state
- User confirmations for destructive actions (sign out)

## Loading States

The component provides visual feedback for all operations:

- Initial loading when fetching accounts
- "Switching..." when changing active account
- "Removing..." when signing out an account
- Disabled buttons during operations

## Styling

The component uses scoped CSS-in-JS for styling. The styles are self-contained and won't conflict with your application styles.

Key visual features:

- Active account highlighted in blue
- Hover effects on interactive elements
- Responsive design
- Scrollable account list for many accounts
- Clear visual hierarchy

## TypeScript Support

The component is fully typed with TypeScript, including:

- API response types matching OpenAuth contracts
- Component prop types
- Internal state types
- Error handling types

## Best Practices

1. **Session Cookies**: The component uses `credentials: "include"` to send session cookies with all requests
2. **Page Refresh**: After switching accounts, the page reloads to ensure all user data is refreshed
3. **Confirmations**: Destructive actions (sign out) require user confirmation
4. **OAuth Redirect**: Adding accounts uses `prompt=select_account` to show the server-side account picker (Google-style flow)
5. **Redirect URI**: The current page URL is passed as the redirect URI for seamless return after auth

## Security Considerations

- All API calls use `credentials: "include"` for secure cookie-based authentication
- Session tokens are handled server-side via HTTP-only cookies
- No sensitive data is stored in client-side state
- CSRF protection should be implemented on the API endpoints

## Future Enhancements

Potential improvements for production use:

- Profile pictures/avatars for accounts
- Account metadata display (email, name)
- Search/filter for many accounts
- Keyboard navigation support
- Animation transitions
- Toast notifications for operations
- Optimistic UI updates
- Internationalization (i18n)
