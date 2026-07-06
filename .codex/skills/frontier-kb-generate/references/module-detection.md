# Module Detection

Use code structure as the primary signal.

## Backend

Start from:

```text
backend/src/main/java/com/frontierscan
```

Top-level packages such as `article`, `auth`, `category`, `collection`, `common`, `llm`, and other siblings are candidate knowledge modules. Keep the current coarse `application` module until a package becomes large, frequently edited, or independently owned.

## Frontend

Start from:

```text
frontend/src
```

Primary areas are `api`, `components`, `layouts`, `router`, `stores`, `styles`, and `views`. Keep the current `web-admin` module unless a workflow becomes large enough to need separate route-level knowledge.

## Helper

Run:

```powershell
.\.harness\scripts\scan-knowledge-inputs.ps1
```

Use the output to decide whether to generate or split knowledge documents.
