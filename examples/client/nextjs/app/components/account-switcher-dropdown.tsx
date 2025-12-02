"use client"

import { useState, useRef, useEffect } from "react"
import { AccountSwitcher } from "./account-switcher"

/**
 * AccountSwitcherDropdown Component
 *
 * A dropdown version of the AccountSwitcher that can be embedded
 * in navigation bars, headers, or anywhere you need a compact
 * account switching UI.
 *
 * This component wraps the full AccountSwitcher in a dropdown menu
 * that can be toggled open/closed.
 *
 * @example
 * ```tsx
 * import { AccountSwitcherDropdown } from "./components/account-switcher-dropdown"
 *
 * export function Header() {
 *   return (
 *     <header>
 *       <nav>
 *         <Logo />
 *         <Navigation />
 *         <AccountSwitcherDropdown />
 *       </nav>
 *     </header>
 *   )
 * }
 * ```
 */
export function AccountSwitcherDropdown({
  apiBaseUrl = "/api",
  authorizeUrl = "/authorize",
  onAccountSwitch,
  onSignOut,
}: {
  apiBaseUrl?: string
  authorizeUrl?: string
  onAccountSwitch?: (userId: string) => void
  onSignOut?: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  /**
   * Close dropdown when clicking outside
   */
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isOpen])

  /**
   * Close dropdown on Escape key
   */
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener("keydown", handleEscape)
    }

    return () => {
      document.removeEventListener("keydown", handleEscape)
    }
  }, [isOpen])

  return (
    <div className="account-switcher-dropdown" ref={dropdownRef}>
      <style jsx>{`
        .account-switcher-dropdown {
          position: relative;
        }

        .trigger-button {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 12px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s;
          font-size: 14px;
          font-weight: 500;
          color: #111827;
        }

        .trigger-button:hover {
          background: #f9fafb;
          border-color: #d1d5db;
        }

        .trigger-button.open {
          background: #f9fafb;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 600;
          font-size: 14px;
        }

        .chevron {
          width: 16px;
          height: 16px;
          transition: transform 0.2s;
        }

        .chevron.open {
          transform: rotate(180deg);
        }

        .dropdown-menu {
          position: absolute;
          top: calc(100% + 8px);
          right: 0;
          min-width: 400px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
          z-index: 50;
          opacity: 0;
          transform: translateY(-8px);
          pointer-events: none;
          transition: all 0.2s;
        }

        .dropdown-menu.open {
          opacity: 1;
          transform: translateY(0);
          pointer-events: auto;
        }

        @media (max-width: 640px) {
          .dropdown-menu {
            position: fixed;
            top: auto;
            bottom: 0;
            left: 0;
            right: 0;
            min-width: 100%;
            border-radius: 16px 16px 0 0;
            transform: translateY(100%);
          }

          .dropdown-menu.open {
            transform: translateY(0);
          }
        }
      `}</style>

      {/* Trigger Button */}
      <button
        className={`trigger-button ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Account switcher"
        aria-expanded={isOpen}
      >
        <div className="avatar">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>

        <span>Accounts</span>

        <svg
          className={`chevron ${isOpen ? "open" : ""}`}
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      <div className={`dropdown-menu ${isOpen ? "open" : ""}`}>
        <AccountSwitcher
          apiBaseUrl={apiBaseUrl}
          authorizeUrl={authorizeUrl}
          onAccountSwitch={(userId) => {
            setIsOpen(false)
            onAccountSwitch?.(userId)
          }}
          onSignOut={() => {
            setIsOpen(false)
            onSignOut?.()
          }}
        />
      </div>
    </div>
  )
}
