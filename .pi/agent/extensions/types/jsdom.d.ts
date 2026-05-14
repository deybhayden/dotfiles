// Type declaration for jsdom (no @types package available)
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string });
    window: {
      document: Document;
    };
  }
}
