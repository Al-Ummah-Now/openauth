# Integration Examples

Complete examples showing how to integrate the AccountSwitcher components into your Next.js application.

## Table of Contents

1. [Basic Integration](#basic-integration)
2. [Header/Navigation Integration](#headernavigation-integration)
3. [Server-Side Integration](#server-side-integration)
4. [API Routes Setup](#api-routes-setup)
5. [Complete Application Example](#complete-application-example)

---

## Basic Integration

The simplest way to add account switching to any page:

```tsx
// app/profile/page.tsx
import { AccountSwitcher } from "@/app/components/account-switcher"

export default function ProfilePage() {
  return (
    <div className="container">
      <h1>User Profile</h1>

      <div className="account-section">
        <h2>Manage Accounts</h2>
        <AccountSwitcher apiBaseUrl="/api" authorizeUrl="/authorize" />
      </div>
    </div>
  )
}
```

---

## Header/Navigation Integration

Add account switching to your site header:

```tsx
// app/components/header.tsx
"use client"

import { AccountSwitcherDropdown } from "./account-switcher-dropdown"

export function Header() {
  return (
    <header className="header">
      <div className="container">
        <div className="header-content">
          {/* Logo */}
          <div className="logo">
            <a href="/">
              <img src="/logo.svg" alt="Logo" />
            </a>
          </div>

          {/* Navigation */}
          <nav className="nav">
            <a href="/dashboard">Dashboard</a>
            <a href="/profile">Profile</a>
            <a href="/settings">Settings</a>
          </nav>

          {/* Account Switcher Dropdown */}
          <AccountSwitcherDropdown
            apiBaseUrl="/api"
            authorizeUrl="/authorize"
            onAccountSwitch={(userId) => {
              // Optional: Track analytics
              console.log("Account switched:", userId)
            }}
            onSignOut={() => {
              // Optional: Clean up and redirect
              window.location.href = "/login"
            }}
          />
        </div>
      </div>

      <style jsx>{`
        .header {
          background: white;
          border-bottom: 1px solid #e5e7eb;
          padding: 16px 0;
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 16px;
        }

        .header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
        }

        .logo img {
          height: 32px;
        }

        .nav {
          display: flex;
          gap: 24px;
          flex: 1;
          margin-left: 48px;
        }

        .nav a {
          color: #111827;
          text-decoration: none;
          font-weight: 500;
          transition: color 0.15s;
        }

        .nav a:hover {
          color: #3b82f6;
        }
      `}</style>
    </header>
  )
}
```

Use in your layout:

```tsx
// app/layout.tsx
import { Header } from "./components/header"

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main>{children}</main>
      </body>
    </html>
  )
}
```

---

## Server-Side Integration

Fetch account information server-side and pass to the component:

```tsx
// app/profile/page.tsx
import { cookies } from "next/headers"
import { AccountSwitcher } from "@/app/components/account-switcher"

/**
 * Fetch session data server-side
 */
async function getSessionData() {
  const cookieStore = cookies()
  const sessionCookie = cookieStore.get("openauth.session")

  if (!sessionCookie) {
    return null
  }

  try {
    const response = await fetch("http://localhost:3000/api/session/check", {
      headers: {
        Cookie: `openauth.session=${sessionCookie.value}`,
      },
    })

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch (error) {
    console.error("Failed to fetch session:", error)
    return null
  }
}

export default async function ProfilePage() {
  const session = await getSessionData()

  if (!session?.active) {
    return (
      <div>
        <h1>Please log in</h1>
        <a href="/authorize">Sign In</a>
      </div>
    )
  }

  return (
    <div className="container">
      <h1>Profile</h1>

      <div className="session-info">
        <p>Active User: {session.activeUserId}</p>
        <p>Total Accounts: {session.accountCount}</p>
      </div>

      <div className="account-section">
        <h2>Manage Accounts</h2>
        <AccountSwitcher apiBaseUrl="/api" authorizeUrl="/authorize" />
      </div>
    </div>
  )
}
```

---

## API Routes Setup

Set up the required API routes in your Next.js app:

```tsx
// app/api/session/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server"

/**
 * Proxy all session requests to the OpenAuth server
 *
 * This allows the client to call /api/session/* endpoints
 * which will be forwarded to your OpenAuth server.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const path = params.path.join("/")
  const openAuthUrl = process.env.OPENAUTH_URL || "http://localhost:3001"

  try {
    const response = await fetch(`${openAuthUrl}/session/${path}`, {
      method: "GET",
      headers: {
        Cookie: request.headers.get("cookie") || "",
      },
    })

    const data = await response.json()

    return NextResponse.json(data, {
      status: response.status,
      headers: {
        "Set-Cookie": response.headers.get("set-cookie") || "",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: "internal_error", message: "Failed to proxy request" },
      { status: 500 },
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const path = params.path.join("/")
  const openAuthUrl = process.env.OPENAUTH_URL || "http://localhost:3001"
  const body = await request.json()

  try {
    const response = await fetch(`${openAuthUrl}/session/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: request.headers.get("cookie") || "",
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()

    return NextResponse.json(data, {
      status: response.status,
      headers: {
        "Set-Cookie": response.headers.get("set-cookie") || "",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: "internal_error", message: "Failed to proxy request" },
      { status: 500 },
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { path: string[] } },
) {
  const path = params.path.join("/")
  const openAuthUrl = process.env.OPENAUTH_URL || "http://localhost:3001"

  try {
    const response = await fetch(`${openAuthUrl}/session/${path}`, {
      method: "DELETE",
      headers: {
        Cookie: request.headers.get("cookie") || "",
      },
    })

    const data = await response.json()

    return NextResponse.json(data, {
      status: response.status,
      headers: {
        "Set-Cookie": response.headers.get("set-cookie") || "",
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: "internal_error", message: "Failed to proxy request" },
      { status: 500 },
    )
  }
}
```

Environment variables:

```bash
# .env.local
OPENAUTH_URL=http://localhost:3001
```

---

## Complete Application Example

A full example showing a complete app with authentication and account switching:

```tsx
// app/page.tsx
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

async function getSession() {
  const cookieStore = cookies()
  const sessionCookie = cookieStore.get("openauth.session")

  if (!sessionCookie) {
    return null
  }

  const response = await fetch("http://localhost:3001/session/check", {
    headers: {
      Cookie: `openauth.session=${sessionCookie.value}`,
    },
  })

  if (!response.ok) {
    return null
  }

  return await response.json()
}

export default async function HomePage() {
  const session = await getSession()

  // Redirect to login if not authenticated
  if (!session?.active) {
    redirect("/authorize")
  }

  return (
    <div className="page">
      <h1>Welcome to OpenAuth Demo</h1>
      <p>You are logged in as: {session.activeUserId}</p>
      <p>You have {session.accountCount} account(s) in this session</p>

      <div className="actions">
        <a href="/dashboard">Go to Dashboard</a>
        <a href="/profile">Manage Accounts</a>
      </div>
    </div>
  )
}
```

```tsx
// app/dashboard/page.tsx
import { AccountSwitcherDropdown } from "@/app/components/account-switcher-dropdown"

export default function DashboardPage() {
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>Dashboard</h1>
        <AccountSwitcherDropdown />
      </header>

      <main className="dashboard-content">
        {/* Your dashboard content */}
        <div className="stats">
          <div className="stat-card">
            <h3>Total Users</h3>
            <p className="stat-value">1,234</p>
          </div>
          <div className="stat-card">
            <h3>Active Sessions</h3>
            <p className="stat-value">56</p>
          </div>
          <div className="stat-card">
            <h3>API Calls</h3>
            <p className="stat-value">12,345</p>
          </div>
        </div>

        <div className="recent-activity">
          <h2>Recent Activity</h2>
          {/* Activity list */}
        </div>
      </main>
    </div>
  )
}
```

```tsx
// app/profile/page.tsx
import { AccountSwitcher } from "@/app/components/account-switcher"
import { cookies } from "next/headers"

async function getUserProfile(userId: string) {
  // Fetch user profile from your API
  return {
    id: userId,
    name: "John Doe",
    email: "john@example.com",
    avatar: "https://i.pravatar.cc/150",
  }
}

async function getSession() {
  const cookieStore = cookies()
  const sessionCookie = cookieStore.get("openauth.session")

  if (!sessionCookie) {
    return null
  }

  const response = await fetch("http://localhost:3001/session/check", {
    headers: {
      Cookie: `openauth.session=${sessionCookie.value}`,
    },
  })

  if (!response.ok) {
    return null
  }

  return await response.json()
}

export default async function ProfilePage() {
  const session = await getSession()

  if (!session?.active) {
    return <div>Please log in</div>
  }

  const profile = await getUserProfile(session.activeUserId)

  return (
    <div className="profile-page">
      <div className="profile-header">
        <img
          src={profile.avatar}
          alt={profile.name}
          className="profile-avatar"
        />
        <div className="profile-info">
          <h1>{profile.name}</h1>
          <p>{profile.email}</p>
        </div>
      </div>

      <div className="profile-content">
        <section className="profile-section">
          <h2>Account Management</h2>
          <p>
            Manage all your logged-in accounts and switch between them
            seamlessly.
          </p>
          <AccountSwitcher
            apiBaseUrl="/api"
            authorizeUrl="/authorize"
            onAccountSwitch={(userId) => {
              // Track account switch
              console.log("Switched to:", userId)
            }}
            onSignOut={() => {
              // Handle sign out
              window.location.href = "/"
            }}
          />
        </section>

        <section className="profile-section">
          <h2>Profile Settings</h2>
          {/* Profile settings form */}
        </section>

        <section className="profile-section">
          <h2>Security</h2>
          {/* Security settings */}
        </section>
      </div>
    </div>
  )
}
```

---

## Testing

Test the account switcher functionality:

```tsx
// __tests__/account-switcher.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AccountSwitcher } from "@/app/components/account-switcher"

// Mock fetch
global.fetch = jest.fn()

describe("AccountSwitcher", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it("fetches and displays accounts", async () => {
    ;(global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        accounts: [
          {
            userId: "user1",
            isActive: true,
            authenticatedAt: Date.now(),
            subjectType: "user",
            clientId: "client1",
          },
        ],
      }),
    })

    render(<AccountSwitcher />)

    await waitFor(() => {
      expect(screen.getByText("user1")).toBeInTheDocument()
    })
  })

  it("switches accounts when button is clicked", async () => {
    ;(global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          accounts: [
            {
              userId: "user1",
              isActive: true,
              authenticatedAt: Date.now(),
              subjectType: "user",
              clientId: "client1",
            },
            {
              userId: "user2",
              isActive: false,
              authenticatedAt: Date.now(),
              subjectType: "user",
              clientId: "client1",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      })

    render(<AccountSwitcher />)

    await waitFor(() => {
      expect(screen.getByText("user2")).toBeInTheDocument()
    })

    const switchButton = screen.getByRole("button", { name: /switch/i })
    fireEvent.click(switchButton)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/session/switch",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ userId: "user2" }),
        }),
      )
    })
  })
})
```

---

## Best Practices

1. **Error Handling**: Always handle API errors gracefully
2. **Loading States**: Show loading indicators during operations
3. **User Feedback**: Provide clear feedback for actions (toasts, messages)
4. **Security**: Use HTTP-only cookies for session tokens
5. **Performance**: Implement optimistic UI updates where appropriate
6. **Accessibility**: Ensure keyboard navigation and screen reader support
7. **Analytics**: Track account switching events for insights
8. **Testing**: Write comprehensive tests for all user flows

---

## Troubleshooting

### Accounts not loading

Check that:

- Session middleware is enabled on the server
- Session routes are mounted at the correct path
- Cookies are being sent with requests (`credentials: "include"`)
- CORS is configured correctly if using separate domains

### Switch not working

Verify:

- The userId exists in the session
- The user has permission to switch accounts
- Session is not expired
- Request body format is correct

### Add account redirect fails

Ensure:

- Authorization URL is correct
- OAuth client is configured properly
- Redirect URI is whitelisted
- `prompt=select_account` parameter is included (shows server-side account picker like Google)
