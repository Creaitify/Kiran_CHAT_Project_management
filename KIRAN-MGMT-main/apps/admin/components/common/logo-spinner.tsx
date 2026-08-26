/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// assets
import LogoMark from "@/app/assets/kcms/logo-mark.png?url";

export function LogoSpinner() {
  return (
    <div className="flex items-center justify-center">
      <img
        src={LogoMark}
        alt="KCMS"
        className="h-8 w-auto animate-pulse object-contain sm:h-12"
      />
    </div>
  );
}
