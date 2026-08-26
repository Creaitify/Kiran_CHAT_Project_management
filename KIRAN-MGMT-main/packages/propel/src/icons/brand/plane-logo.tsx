/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import type { ISvgIcons } from "../type";
import { KCMS_LOGO_MARK } from "./kcms-assets";

export function PlaneLogo({ width, height, className }: ISvgIcons) {
  return (
    <img
      src={KCMS_LOGO_MARK}
      alt="KCMS"
      width={width}
      height={height}
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
