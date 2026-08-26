/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React from "react";
import { observer } from "mobx-react";
// lib
import { AppRailVisibilityProvider } from "@/lib/app-rail";
// local imports
import { useApps } from "./use-apps";

/**
 * Turns the app rail on when there is more than one app to switch between.
 *
 * `AppRailVisibilityProvider` takes `isEnabled` as a prop and defaults it to
 * false, which is why the rail has never rendered: Projects was the only app,
 * and nobody had a reason to pass true. This is the piece that answers the
 * question from the registry instead of from a literal.
 *
 * Separate from the provider itself on purpose -- the provider is generic
 * plumbing that a test or a storybook can drive directly, and this is the
 * product's policy about when to show the thing.
 */
export const AppRailProvider = observer(function AppRailProvider({ children }: { children: React.ReactNode }) {
  const { hasMultipleApps } = useApps();

  return <AppRailVisibilityProvider isEnabled={hasMultipleApps}>{children}</AppRailVisibilityProvider>;
});
