/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";
import { KCMS_LOGO_FULL } from "./kcms-assets";

export function PlaneLockup({ width, height, className }: ISvgIcons) {
  return (
    <img
      src={KCMS_LOGO_FULL}
      alt="Kiran Cable Management System"
      width={width}
      height={height}
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
