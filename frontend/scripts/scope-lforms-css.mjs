import { readFileSync, writeFileSync } from "node:fs";

// LForms attaches popups to <body> outside wc-lhc-form, so those containers
// must be scope roots too.
const SCOPE_ROOTS =
  "wc-lhc-form, #lhc-tools-searchResults, .cdk-overlay-container";

// Selectors inside @scope only match descendants of the roots, never the
// root elements themselves, so rules whose subject is a root (or another
// body-attached LForms container) must stay global. They are LForms-specific
// ids/classes and cannot affect app elements.
const ROOT_SUBJECTS = [
  "wc-lhc-form",
  "#lhc-tools-searchResults",
  ".form_auto_complete",
  ".auto_complete",
  ".cdk-overlay-container",
];

function extractRootRules(css) {
  const rules = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const subjects = match[1]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => ROOT_SUBJECTS.includes(s));
    if (subjects.length) {
      rules.push(`${subjects.join(",")}{${match[2]}}`);
    }
  }
  return rules.join("\n");
}

const cssPath = new URL("../public/lforms/styles.css", import.meta.url);
const css = readFileSync(cssPath, "utf8");

if (!css.startsWith("@scope")) {
  // The original stylesheet declares these custom properties on html, which
  // is outside the scope roots and would never match.
  const customProps = `:is(${SCOPE_ROOTS}) { --antd-wave-shadow-color: #1890ff; --scroll-bar: 0; }`;
  writeFileSync(
    cssPath,
    `@scope (${SCOPE_ROOTS}) {\n${css}\n}\n${extractRootRules(css)}\n${customProps}\n`,
  );
  console.log("Scoped public/lforms/styles.css");
}
