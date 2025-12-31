---
"@opencode-vibe/react": minor
"web": minor
---

feat(react): implement SSR plugin for provider-free hooks (ADR-013 Phase 2)

```
    🦋 THE GREAT PROVIDER PURGE 🦋
    
        ⋆ ˚｡⋆୨♡୧⋆ ˚｡⋆
    ,.  _~-.,               .
   ~'`~ \/,_. ~=.,,,.,,,   /|,
        /   '-._  /'   '\\=~
       |  \     \|        |
        \  '=.,_/         |
         '-.,_   '~-.,_  /
              '~.,_    '~

    BEFORE:                    AFTER:
    ┌──────────────────┐      ┌──────────────────┐
    │ <Provider>       │      │ <SSRPlugin />    │
    │   <Provider>     │  →   │ {children}       │
    │     <Provider>   │      └──────────────────┘
    │       {children} │
    │     </Provider>  │      Zero ceremony.
    │   </Provider>    │      Zero wrappers.
    │ </Provider>      │      Just works.
    └──────────────────┘
```

> "Simplicity is prerequisite for reliability."
> — Dijkstra

Implements uploadthing-inspired factory + SSR plugin pattern:
- `<OpencodeSSRPlugin>` injects config via `useServerInsertedHTML`
- `generateOpencodeHelpers()` creates hooks that read from `globalThis`
- Zero hydration delay, zero provider wrappers, works in RSC
