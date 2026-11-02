/// <reference types="vite/client" />

/** This app's package.json version, inlined by vite.config.ts (ESCSUITE-369). */
declare const __APP_VERSION__: string;

declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}

declare module '*.css' {
  const content: string;
  export default content;
}
