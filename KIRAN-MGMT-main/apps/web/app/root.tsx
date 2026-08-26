/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect, useState, type ReactNode } from "react";
import Script from "next/script";
import { Links, Meta, Outlet, Scripts } from "react-router";
import type { LinksFunction } from "react-router";
import { ThemeProvider, useTheme } from "next-themes";
// KCMS imports
import { SITE_DESCRIPTION, SITE_NAME, WEB_URL } from "@plane/constants";
import { cn } from "@plane/utils";
// types
// assets
import favicon16 from "@/app/assets/favicon/favicon-16x16.png?url";
import favicon32 from "@/app/assets/favicon/favicon-32x32.png?url";
import faviconIco from "@/app/assets/favicon/favicon.ico?url";
import icon180 from "@/app/assets/icons/icon-180x180.png?url";
import icon512 from "@/app/assets/icons/icon-512x512.png?url";
// constants
import { DEFAULT_THEME, THEME_MIGRATION_KEY, THEME_MIGRATION_VERSION, THEME_STORAGE_KEY } from "@/constants/theme";
import ogImage from "@/app/assets/og-image.png?url";
import globalStyles from "@/styles/globals.css?url";
import type { Route } from "./+types/root";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
// lib
import { isStaleAssetError, recoverFromStaleAsset } from "@/lib/stale-asset-error";
// local
import { CustomErrorComponent } from "./error";
import { AppProvider } from "./provider";
// fonts
import "@fontsource-variable/inter";
import interVariableWoff2 from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import "@fontsource/material-symbols-rounded";
import "@fontsource/ibm-plex-mono";

const APP_TITLE = "KCMS | Kiran Cable Management System";

export const links: LinksFunction = () => [
  { rel: "icon", type: "image/png", sizes: "32x32", href: favicon32 },
  { rel: "icon", type: "image/png", sizes: "16x16", href: favicon16 },
  { rel: "shortcut icon", href: faviconIco },
  { rel: "manifest", href: "/site.webmanifest.json" },
  { rel: "apple-touch-icon", href: icon512 },
  { rel: "apple-touch-icon", sizes: "180x180", href: icon180 },
  { rel: "apple-touch-icon", sizes: "512x512", href: icon512 },
  { rel: "manifest", href: "/manifest.json" },
  { rel: "stylesheet", href: globalStyles },
  {
    rel: "preload",
    href: interVariableWoff2,
    as: "font",
    type: "font/woff2",
    crossOrigin: "anonymous",
  },
  // Display face for headings; falls back to Inter when offline.
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap",
  },
];

export function Layout({ children }: { children: ReactNode }) {
  const isSessionRecorderEnabled = parseInt(process.env.VITE_ENABLE_SESSION_RECORDER || "0");

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* Browser chrome colour follows the theme. A single #fff here made the
            address bar white while the app was on the near-black canvas. */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#eaf6ff" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#030812" />
        {/* Meta info for PWA */}
        <meta name="application-name" content="KCMS" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        {/* One-time migration of the old default, inlined in <head> on purpose.
            next-themes injects its own blocking script inside ThemeProvider,
            further down the body — running after that one would paint the stored
            theme and then correct it, a visible flash on exactly the load we want
            to look deliberate. Failing silently is correct: a browser that refuses
            localStorage still gets the provider default. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var m="${THEME_MIGRATION_KEY}",v="${THEME_MIGRATION_VERSION}",t="${THEME_STORAGE_KEY}";if(localStorage.getItem(m)!==v){if(localStorage.getItem(t)==="system"){localStorage.setItem(t,"${DEFAULT_THEME}")}localStorage.setItem(m,v)}}catch(e){}`,
          }}
        />
        <Meta />
        <Links />
      </head>
      <body suppressHydrationWarning>
        <div id="context-menu-portal" />
        <div id="editor-portal" />
        {/* `attribute` is pinned deliberately. next-themes defaults to
            "data-theme" as of 0.4.x, but it was "class" in 0.3.x and the
            default is not part of the documented API — every theme in the app
            is selected by [data-theme], so relying on the default means a
            minor version bump could silently unstyle the entire product. */}
        <ThemeProvider
          attribute="data-theme"
          themes={["light", "dark", "light-contrast", "dark-contrast", "custom"]}
          defaultTheme={DEFAULT_THEME}
        >
          {children}
        </ThemeProvider>
        <Scripts />
        {!!isSessionRecorderEnabled && process.env.VITE_SESSION_RECORDER_KEY && (
          <Script id="clarity-tracking">
            {`(function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];if(y){y.parentNode.insertBefore(t,y);}
          })(window, document, "clarity", "script", "${process.env.VITE_SESSION_RECORDER_KEY}");`}
          </Script>
        )}
      </body>
    </html>
  );
}

export const meta: Route.MetaFunction = () => [
  { title: APP_TITLE },
  { name: "description", content: SITE_DESCRIPTION },
  { property: "og:title", content: APP_TITLE },
  { property: "og:description", content: SITE_DESCRIPTION },
  // Driven by VITE_WEB_BASE_URL so link previews point at the deployed host
  // instead of whichever machine happened to build the bundle.
  { property: "og:url", content: WEB_URL || "/" },
  { property: "og:image", content: ogImage },
  { property: "og:image:width", content: "1200" },
  { property: "og:image:height", content: "630" },
  { property: "og:image:alt", content: "Kiran Cable Management System" },
  {
    name: "keywords",
    content:
      "software development, plan, ship, software, accelerate, code management, release management, project management, work item tracking, agile, scrum, kanban, collaboration",
  },
  { name: "twitter:site", content: "@kirancableppl" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:image", content: ogImage },
  { name: "twitter:image:width", content: "1200" },
  { name: "twitter:image:height", content: "630" },
  { name: "twitter:image:alt", content: "Kiran Cable Management System" },
];

export default function Root() {
  return (
    <AppProvider>
      <div
        className={cn(
          "kx-ambient relative flex h-screen w-full flex-col overflow-hidden bg-canvas",
          "desktop-app-container"
        )}
      >
        <main className="relative h-full w-full overflow-hidden">
          <Outlet />
        </main>
      </div>
    </AppProvider>
  );
}

export function HydrateFallback() {
  const { resolvedTheme } = useTheme();
  // Branching on `typeof window` here used to break hydration: the server
  // emitted an empty <div />, while the very first client render already saw a
  // window (and often a resolved theme) and emitted the spinner instead. React
  // compared the two trees, found an extra child, and tore the root down —
  // which in dev surfaces as an unhandled error that takes the server with it.
  // Gate on mount instead, so the first client render is byte-identical to the
  // server's and the spinner only appears on the commit after hydration.
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => setIsMounted(true), []);

  if (!isMounted || resolvedTheme === undefined) return <div />;

  return (
    <div className="relative flex h-screen w-full items-center justify-center bg-canvas">
      <LogoSpinner />
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // A stale chunk failure surfaces here as React Router's own wrapper error
  // (the failed dynamic import itself never reaches a window event) — recover
  // the same way entry.client.tsx does instead of just showing the error page.
  if (import.meta.env.PROD && isStaleAssetError(error)) recoverFromStaleAsset();

  return <CustomErrorComponent error={error} />;
}
