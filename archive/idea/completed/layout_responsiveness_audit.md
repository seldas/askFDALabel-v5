# AskFDALabel Suite: Layout & Responsiveness Audit

This document tracks potential display and layout issues observed when resizing the application window across different viewports (Mobile, Tablet, Desktop).

## 1. Homepage (Suite Landing)
- [x] **Hero Section Height**: Optimized with `clamp` and media queries.
- [x] **Carousel Content**: Readability improved on small screens.
- [x] **Navigation Menu**: Implemented responsive hamburger menu.
- [x] **Service Grid**: Responsive grid with `auto-fit`.

## 2. Global Header
- [x] **Branding Text**: Now collapses "Suite" on mobile.
- [x] **User Controls**: Integrated into the mobile menu drawer.
- [x] **Internal/External Badges**: Styled for better space management.

## 3. Dashboard
- [x] **DataTables**: Wrapped in scrollable containers for mobile.
- [x] **Sidebar vs. Content**: Layout adjusted for mobile.

## 4. AFL Agent (Search)
- [x] **Chat Interface**: 2-column layout now stacks vertically on mobile.
- [x] **Flowchart Image**: Made fully responsive with `width: 100%`.

## 5. Label Compare
- [x] **Side-by-Side View**: Implemented `side-by-side-grid` which stacks on mobile (< 900px).

## 6. Snippet Store
- [x] **Card Layout**: Responsive grid and card padding.

## 7. Modals (Login/Register)
- [x] **Padding & Scale**: Moved to CSS with media query support for mobile.
