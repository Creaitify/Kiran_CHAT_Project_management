/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import * as React from "react";

import { KCMS_LOGO_MARK } from "../brand/kcms-assets";
import type { ISvgIcons } from "../type";

export function PlaneNewIcon({ className, width, height }: ISvgIcons) {
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
