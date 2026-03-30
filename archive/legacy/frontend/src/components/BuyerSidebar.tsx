import React, { useMemo, useRef } from "react";

type SidebarItem = {
  id: string;
  label: string;
  href: string;
  ariaLabel?: string;
};

const NAV_ITEMS: SidebarItem[] = [
  { id: "wishlists", label: "Review your Wishlist", href: "/buyers/wishlists" },
  { id: "budget", label: "Budget Coach", href: "/buyers/budget-coach" },
  { id: "messages", label: "Messages", href: "/buyers/messages" },
  { id: "account", label: "Account", href: "/buyers/account" },
];

export interface BuyerSidebarProps {
  activeItemId?: string;
  onNavigate?: (item: SidebarItem) => void;
}

const styles = `
  .buyer-sidebar { color: #0f172a; background: #f8fafc; padding: 1.5rem 1rem; width: 240px; border-right: 1px solid #e2e8f0; }
  .buyer-sidebar__heading { font-size: 1rem; font-weight: 600; margin-bottom: 1rem; color: #0f172a; }
  .buyer-sidebar__list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .buyer-sidebar__button { width: 100%; text-align: left; background: none; border: 1px solid transparent; border-radius: 0.75rem; padding: 0.75rem 1rem; font-size: 0.95rem; cursor: pointer; color: inherit; transition: background 0.2s ease, border-color 0.2s ease; }
  .buyer-sidebar__button:hover { background: #e0f2fe; border-color: #38bdf8; }
  .buyer-sidebar__button:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; background: #dbeafe; }
  .buyer-sidebar__button[aria-current="page"] { background: #bae6fd; border-color: #0ea5e9; font-weight: 600; }
`;

export const BuyerSidebar: React.FC<BuyerSidebarProps> = ({ activeItemId, onNavigate }) => {
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const navigation = useMemo(() => NAV_ITEMS.map((item) => ({ ...item })), []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const focusable = buttonsRef.current.filter(Boolean) as HTMLButtonElement[];
    if (focusable.length === 0) return;

    const currentIndex = focusable.findIndex((button) => button === document.activeElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % focusable.length : 0;
      focusable[nextIndex]?.focus();
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const prevIndex = currentIndex >= 0 ? (currentIndex - 1 + focusable.length) % focusable.length : focusable.length - 1;
      focusable[prevIndex]?.focus();
    }
  };

  return (
    <>
      <style>{styles}</style>
      <nav className="buyer-sidebar" aria-label="Buyer navigation">
        <h2 className="buyer-sidebar__heading">Stay oriented</h2>
        <ul className="buyer-sidebar__list" onKeyDown={handleKeyDown}>
          {navigation.map((item, index) => (
            <li key={item.id}>
              <button
                ref={(element) => {
                  buttonsRef.current[index] = element;
                }}
                type="button"
                className="buyer-sidebar__button"
                aria-label={item.ariaLabel ?? item.label}
                aria-current={item.id === activeItemId ? "page" : undefined}
                onClick={() => onNavigate?.(item)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
};

export default BuyerSidebar;
