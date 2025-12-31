# ADR-014: Vercel Sandbox Swarm Infrastructure

**Status:** Proposed  
**Date:** 2025-12-30  
**Deciders:** Joel Hooks, Architecture Team  
**Affected Components:** Swarm deployment, Worker execution, Control plane scaling

---

## Context

OpenCode Vibe (ADR-003) established the control plane architecture with Effect Router + Swarm Mail orchestration. We have:

- ✅ **Layer 1-3:** Primitives, Coordination, Orchestration (built, working)
- ✅ **Layer 4 (local):** Runs on dev machines with libSQL + git
- ⏳ **Layer 4 (cloud):** Planned for ECS Fargate → EKS

**The Cloud Deployment Problem:**

The ECS/EKS path (ADR-003 Phase 4-5) is **correct for production at scale**, but has a **painful PoC/MVP gap**:

| Barrier                | Impact                                                          |
| ---------------------- | --------------------------------------------------------------- |
| **Infrastructure**     | VPC, RDS, ElastiCache, ALB setup before running first swarm    |
| **Container registry** | ECR setup, image builds, multi-stage Dockerfiles               |
| **Deployment time**    | 5-10min per Pulumi stack deploy, slower iteration               |
| **Cost floor**         | ~$100/month minimum (RDS + Redis + ALB), even for 1 user       |
| **Complexity**         | ECS task definitions, service discovery, IAM roles, autoscaling |

**This violates a core principle:**

> "Make swarm deployment **trivially easy** AND **infinitely scalable**. Same architecture handles 1 user or 1000 users."

**The Insight:**

Vercel Sandbox + Vercel Workflow provide a **serverless Layer 4** that:

- Deploys in seconds (not minutes)
- Scales from 0 to 50+ workers instantly
- Costs $0 at zero usage (not $100/month floor)
- Requires zero infrastructure setup
- **Still allows migration to ECS/EKS later**

This ADR proposes **Vercel Sandbox Swarm as the PoC/MVP deployment layer**, with ECS/EKS as the escape hatch when scale demands it.

---

## Decision

**Use Vercel Sandbox + Vercel Workflow as Layer 4 deployment for PoC/MVP. Preserve ECS/EKS path for post-PMF scaling.**

### Architecture Addition to ADR-003

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER 4: DEPLOYMENT                                            │
│                                                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐ │
│  │ Vercel Sandbox   │  │  ECS Fargate     │  │  EKS (K8s)   │ │
│  │ (PoC/MVP)        │  │  (Scale)         │  │  (Enterprise)│ │
│  │ - 0 to 50 users  │  │  - 50-500 users  │  │  - 500+ users│ │
│  │ - $0 floor       │  │  - ~$100/mo floor│  │  - Custom    │ │
│  │ - Zero config    │  │  - VPC + RDS     │  │  - K8s ops   │ │
│  └──────────────────┘  └──────────────────┘  └──────────────┘ │
│         ↑                      ↑                     ↑          │
│         └──────── Migration triggers ────────────────┘          │
│                  (see section below)                            │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 3: ORCHESTRATION                                         │
│  Effect Router (DAG workflows, typed routes, streaming)        │
│  Swarm Mail (actor model, event sourcing, file locks)          │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 2: COORDINATION                                          │
│  Hive (git-backed work tracking)                               │
│  Semantic Memory (vector search, learnings)                    │
│  Learning System (confidence decay, anti-patterns)             │
├─────────────────────────────────────────────────────────────────┤
│  LAYER 1: PRIMITIVES                                            │
│  DurableMailbox, DurableLock, DurableCursor, EventStore        │
│  All built on Effect-TS + libSQL (embedded SQLite)             │
└─────────────────────────────────────────────────────────────────┘
```

**Key Principle:** Same Layers 1-3 code. Only Layer 4 changes. Migration is **horizontal** (Sandbox → ECS → EKS), not vertical.

---

## Architecture Overview

### The N+1 Pattern

Every swarm spawns **1 Coordinator + N Workers**:

```
                /swarm "Implement auth system"
                            │
                            ▼
        ┌───────────────────────────────────┐
        │      COORDINATOR                  │
        │  (Vercel Workflow - durable)      │  ← 'use workflow' directive
        │                                   │     Survives deploys, crashes
        │  ┌─────────────────────────────┐  │     Pauses for hours (sleep)
        │  │ 1. Decompose task           │  │     Waits for review (hooks)
        │  │ 2. Create epic + subtasks   │  │
        │  │ 3. Spawn workers (N steps)  │  │
        │  │ 4. Monitor progress         │  │
        │  │ 5. Review completions       │  │
        │  │ 6. Synthesize results       │  │
        │  └─────────────────────────────┘  │
        └──────────┬────────────────────────┘
                   │ use step() for each worker
                   │
         ┌─────────┴──────────┬──────────┬──────────┐
         ▼                    ▼          ▼          ▼
    ┌────────┐          ┌────────┐  ┌────────┐  ┌────────┐
    │Worker 1│          │Worker 2│  │Worker 3│  │Worker N│
    │(Sandbox)│          │(Sandbox)│ │(Sandbox)│ │(Sandbox)│
    └────────┘          └────────┘  └────────┘  └────────┘
         │                    │          │          │
         └────────┬───────────┴──────────┴──────────┘
                  ▼
        External State (Redis + Turso + Git)
        - Swarm Mail (coordination)
        - EventStore (events)
        - Hive (work items)
        - Semantic Memory (learnings)
```

**What makes this powerful:**

- **Coordinator** = long-lived orchestrator (hours/days)
- **Workers** = ephemeral executors (minutes, then die)
- **State** = external, shared across both
- **Scaling** = spawn 50 workers in parallel, Vercel handles capacity

---

## Coordinator as Vercel Workflow

### What is Vercel Workflow?

Durable orchestration primitive that survives crashes, redeploys, and long pauses.

**Key Features:**

| Feature         | Capability                                     | Why It Matters                                |
| --------------- | ---------------------------------------------- | --------------------------------------------- |
| **'use workflow'** | Marks function as durable                   | State survives deploys                        |
| **'use step'**     | Each step is a checkpoint                   | Retry failed steps without restarting         |
| **sleep()**        | Pause for hours/days with no compute cost   | Wait between phases, review cycles            |
| **defineHook()**   | Wait for external events (human approval)   | Review before merging, gating risky work      |
| **Observability**  | Built-in logs, metrics, tracing in dashboard | No custom instrumentation needed             |
| **Deterministic**  | Replay from checkpoints on crash            | Fault-tolerant by design                      |

**Pricing:** $2.50 per 100k steps, $0.00069 per GB-hour storage

### Coordinator Implementation

```typescript
// apps/web/api/swarm/coordinator/route.ts
import { workflow } from '@vercel/workflow'

export const POST = workflow('swarm-coordinator', async (req) => {
  'use workflow'
  
  const { task, epic_id } = await req.json()
  
  // STEP 1: Decompose task
  const decomposition = await step('decompose', async () => {
    return await swarm_decompose({ 
      task, 
      max_subtasks: 10,
      query_hivemind: true 
    })
  })
  
  // STEP 2: Validate decomposition
  const validated = await step('validate', async () => {
    return await swarm_validate_decomposition({ 
      response: decomposition 
    })
  })
  
  // STEP 3: Create hive epic + subtasks atomically
  const epic = await step('create-epic', async () => {
    return await hive_create_epic({
      epic_title: validated.epic.title,
      epic_description: validated.epic.description,
      subtasks: validated.subtasks
    })
  })
  
  // STEP 4: Spawn workers in parallel (each is a durable step)
  const results = await Promise.all(
    epic.subtasks.map((subtask, idx) =>
      step(`worker-${idx}`, async () => {
        return await spawnWorkerSandbox({
          subtask_id: subtask.id,
          epic_id: epic.id,
          files: subtask.files,
          prompt: swarm_subtask_prompt({
            bead_id: subtask.id,
            epic_id: epic.id,
            subtask_title: subtask.title,
            files: subtask.files
          })
        })
      })
    )
  )
  
  // STEP 5: Review each completion
  for (const [idx, result] of results.entries()) {
    const review = await step(`review-${idx}`, async () => {
      return await swarm_review({
        project_key: process.env.PROJECT_PATH,
        epic_id: epic.id,
        task_id: result.task_id,
        files_touched: result.files_touched
      })
    })
    
    // HOOK: Wait for human approval if review flagged issues
    if (review.needs_human) {
      await defineHook(`approve-${idx}`, async (approval) => {
        if (!approval.approved) {
          throw new Error(`Task ${result.task_id} rejected: ${approval.reason}`)
        }
      })
    }
  }
  
  // STEP 6: Synthesize and close epic
  await step('finalize', async () => {
    await hive_close(epic_id, `Completed: ${results.length} subtasks merged`)
  })
  
  return { epic_id, subtask_count: results.length, results }
})
```

### Why Workflow Fits

- **Long-running:** Swarms take minutes to hours
- **Multi-phase:** Decompose → Spawn → Monitor → Review → Merge
- **Fault-tolerant:** Workers crash, coordinator survives
- **Review gates:** Workflow hooks = human approval points
- **Cost-efficient:** Sleep between phases, pay only for active steps

---

## Workers as Vercel Sandboxes

### What is Vercel Sandbox?

Ephemeral Linux environments (Amazon Linux 2023, Node 24) that run arbitrary code.

**Key Features:**

| Feature          | Capability                           | Why It Matters                          |
| ---------------- | ------------------------------------ | --------------------------------------- |
| **Full OS**      | Amazon Linux 2023, 4 vCPUs           | Can install OpenCode, clone repos       |
| **Runtimes**     | node24, node22, python3.13           | Supports all OpenCode dependencies      |
| **Timeout**      | 45min (Hobby), 5hr (Pro/Enterprise)  | Long enough for AI agent work           |
| **Parallelism**  | 50+ sandboxes concurrently           | Massive swarm scaling                   |
| **Ephemeral**    | Auto-cleanup after completion        | No lingering compute costs              |
| **Network**      | Full internet access + exposed ports | Can hit external state (Redis, Turso)   |

**Pricing:** Bundled with Vercel Pro ($20/month) for reasonable usage

### Worker Bootstrap Pattern

**Key Insight:** Each sandbox IS a complete OpenCode environment.

```typescript
// apps/web/api/swarm/worker/spawn.ts
import { sandbox } from '@vercel/sandbox'

export async function spawnWorkerSandbox({
  subtask_id,
  epic_id,
  files,
  prompt
}: {
  subtask_id: string
  epic_id: string
  files: string[]
  prompt: string
}) {
  // Create sandbox with Node 24 runtime
  const sbx = await sandbox.create({
    runtime: 'node24',
    resources: { vcpu: 4 }
  })
  
  try {
    // 1. Clone the repo
    await sbx.runCommand({
      command: 'git',
      args: ['clone', process.env.REPO_URL, '/workspace']
    })
    
    // 2. Install OpenCode globally
    await sbx.runCommand({
      command: 'bun',
      args: ['install', '-g', '@opencode/cli'],
      cwd: '/workspace'
    })
    
    // 3. Set up environment (external state URLs)
    await sbx.writeFile('/.env', `
      REDIS_URL=${process.env.REDIS_URL}
      TURSO_URL=${process.env.TURSO_URL}
      TURSO_AUTH_TOKEN=${process.env.TURSO_AUTH_TOKEN}
      GITHUB_TOKEN=${process.env.GITHUB_TOKEN}
      SWARM_AGENT_NAME=Worker-${subtask_id.slice(0, 8)}
      SWARM_PROJECT_PATH=/workspace
      SWARM_EPIC_ID=${epic_id}
      SWARM_TASK_ID=${subtask_id}
    `)
    
    // 4. Run OpenCode with swarm worker prompt
    const result = await sbx.runCommand({
      command: 'opencode',
      args: ['--prompt', prompt],
      cwd: '/workspace',
      timeout: 3600000 // 1 hour max
    })
    
    // 5. Extract results (files touched, completion status)
    const filesChanged = await sbx.runCommand({
      command: 'git',
      args: ['diff', '--name-only', 'HEAD'],
      cwd: '/workspace'
    })
    
    return {
      task_id: subtask_id,
      exit_code: result.exitCode,
      files_touched: filesChanged.stdout.split('\n').filter(Boolean),
      stdout: result.stdout,
      stderr: result.stderr
    }
  } finally {
    // Cleanup sandbox (frees resources)
    await sbx.stop()
  }
}
```

### Worker Execution Flow

```
┌──────────────────────────────────────────────────────┐
│  SANDBOX LIFECYCLE                                   │
├──────────────────────────────────────────────────────┤
│                                                      │
│  1. CREATE                                           │
│     sandbox.create({ runtime: 'node24' })            │
│                                                      │
│  2. SETUP                                            │
│     - git clone <repo>                               │
│     - bun install -g @opencode/cli                   │
│     - write .env with external state URLs            │
│                                                      │
│  3. RESERVE FILES                                    │
│     opencode runs swarmmail_reserve()                │
│     → Writes to shared Redis                         │
│                                                      │
│  4. EXECUTE TASK                                     │
│     opencode --prompt "<swarm worker prompt>"        │
│     - Reads/edits assigned files                     │
│     - Reports progress via swarmmail_send()          │
│     - Stores learnings via hivemind_store()          │
│                                                      │
│  5. COMPLETE                                         │
│     opencode runs swarm_complete()                   │
│     - Releases file reservations                     │
│     - Records outcome to EventStore                  │
│     - Returns exit code + files touched              │
│                                                      │
│  6. CLEANUP                                          │
│     sandbox.stop()                                   │
│     → Sandbox destroyed, resources freed             │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Why This Works:**

- **Isolation:** Each worker gets fresh environment
- **No state leakage:** Sandboxes destroyed after use
- **Standard tooling:** Workers use same `opencode` CLI as local dev
- **Coordination:** External state (Redis + Turso) enables cross-sandbox communication

---

## External State Adapters

Sandboxes are ephemeral, so state MUST be external.

### State Component Migration

| Component        | Local Dev         | Vercel Cloud                | Required Changes                         |
| ---------------- | ----------------- | --------------------------- | ---------------------------------------- |
| **EventStore**   | libSQL file       | Turso (libSQL cloud)        | Connection string in env                 |
| **Swarm Mail**   | libSQL file       | Redis + Turso (hybrid)      | Mailbox writes → Redis, events → Turso   |
| **Hive**         | Git + JSONL       | Git + Vercel KV (cache)     | KV for fast lookups, Git as source       |
| **Memory**       | Ollama + libSQL   | External embeddings + Turso | Replace Ollama with OpenAI/Voyage/Cohere |
| **File Locks**   | libSQL CAS        | Redis SET NX EX             | Distributed lock pattern                 |

### Swarm Mail Redis Adapter

```typescript
// packages/core/src/sse/swarm-mail-redis.ts
import { Redis } from '@upstash/redis'

export class SwarmMailRedisAdapter {
  private redis: Redis
  
  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token })
  }
  
  // DurableMailbox operations
  async send(message: Message): Promise<void> {
    const key = `mailbox:${message.to}`
    await this.redis.rpush(key, JSON.stringify(message))
    await this.redis.expire(key, 86400) // 24hr TTL
  }
  
  async inbox(agent: string, limit = 5): Promise<Message[]> {
    const key = `mailbox:${agent}`
    const messages = await this.redis.lrange(key, 0, limit - 1)
    return messages.map(m => JSON.parse(m))
  }
  
  // DurableLock operations (file reservations)
  async reserve(paths: string[], agent: string, ttl: number): Promise<boolean> {
    const multi = this.redis.multi()
    
    for (const path of paths) {
      const key = `lock:${path}`
      // SET NX EX = atomic lock acquisition
      multi.set(key, agent, { nx: true, ex: ttl })
    }
    
    const results = await multi.exec()
    return results.every(r => r === 'OK')
  }
  
  async release(paths: string[], agent: string): Promise<void> {
    const multi = this.redis.multi()
    
    for (const path of paths) {
      const key = `lock:${path}`
      // Release only if we own the lock
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `
      multi.eval(script, [key], [agent])
    }
    
    await multi.exec()
  }
}
```

### Hive Git + Vercel KV Pattern

```typescript
// packages/core/src/atoms/hive-cloud.ts
import { kv } from '@vercel/kv'
import { execSync } from 'child_process'

export class HiveCloudAdapter {
  // Write-through cache: Git is source of truth, KV is fast lookup
  
  async createCell(cell: Cell): Promise<Cell> {
    // 1. Write to Git (source of truth)
    const jsonl = JSON.stringify(cell)
    execSync(`echo '${jsonl}' >> .hive/issues.jsonl`)
    execSync(`git add .hive/issues.jsonl && git commit -m "hive: create ${cell.id}"`)
    
    // 2. Write to KV (fast lookup cache)
    await kv.hset(`cell:${cell.id}`, cell)
    await kv.zadd('cells:by-priority', { score: cell.priority, member: cell.id })
    
    return cell
  }
  
  async getCell(id: string): Promise<Cell | null> {
    // Try KV first (fast path)
    let cell = await kv.hget(`cell:${id}`)
    
    if (!cell) {
      // Fallback to Git (rebuild cache)
      cell = this.parseCellFromGit(id)
      if (cell) {
        await kv.hset(`cell:${id}`, cell)
      }
    }
    
    return cell
  }
  
  async sync(): Promise<void> {
    // Push to remote, clear KV cache to force rebuild
    execSync('git push origin main')
    await kv.flushdb() // Invalidate cache
  }
}
```

### Memory External Embeddings

```typescript
// packages/core/src/atoms/memory-cloud.ts
import { OpenAI } from 'openai'

export class MemoryCloudAdapter {
  private openai: OpenAI
  
  constructor(apiKey: string) {
    this.openai = new OpenAI({ apiKey })
  }
  
  async store(information: string, tags: string): Promise<void> {
    // 1. Generate embedding (replace Ollama)
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: information
    })
    const embedding = response.data[0].embedding
    
    // 2. Store in Turso with vector extension
    await db.execute({
      sql: `
        INSERT INTO memories (id, information, tags, embedding, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      args: [ulid(), information, tags, embedding, Date.now()]
    })
  }
  
  async find(query: string, limit = 5): Promise<Memory[]> {
    // 1. Generate query embedding
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query
    })
    const queryEmbedding = response.data[0].embedding
    
    // 2. Vector similarity search in Turso
    const results = await db.execute({
      sql: `
        SELECT id, information, tags, 
               vector_distance_cos(embedding, ?) as distance
        FROM memories
        ORDER BY distance ASC
        LIMIT ?
      `,
      args: [queryEmbedding, limit]
    })
    
    return results.rows as Memory[]
  }
}
```

**Migration Checklist:**

- [ ] Replace libSQL file paths with Turso connection strings
- [ ] Replace Ollama with OpenAI/Voyage embeddings API
- [ ] Add Redis adapter for Swarm Mail mailboxes + locks
- [ ] Add Vercel KV adapter for Hive fast lookups
- [ ] Update environment variables in Vercel dashboard
- [ ] Test worker spawn with external state connectivity

---

## Scale Model

### Cost Breakdown

**Vercel Pro:** $20/month baseline

- Includes reasonable Sandbox + Workflow usage
- 50 parallel sandboxes supported
- Workflow steps bundled

**Additional costs at scale:**

| Resource              | Unit Cost            | 100 Tasks/Day | 1000 Tasks/Day |
| --------------------- | -------------------- | ------------- | -------------- |
| Workflow steps        | $2.50 / 100k steps   | ~$0.75        | ~$7.50         |
| Sandbox compute       | Bundled (Pro)        | $0            | $0*            |
| Turso (EventStore)    | Free tier → $29/mo   | Free          | $29            |
| Upstash Redis         | Free tier → $10/mo   | Free          | $10            |
| Vercel KV             | Bundled (Pro)        | $0            | $0             |
| OpenAI embeddings     | $0.13 / 1M tokens    | ~$2           | ~$20           |

**Total monthly cost:**

- **Low usage (100 tasks/day):** $20 (Vercel Pro only)
- **Medium usage (1000 tasks/day):** ~$87/month
- **High usage (5000 tasks/day):** ~$300/month

*Sandbox compute bundled until exceeding Pro limits, then pay-as-you-go

**Comparison to ECS (from ADR-003):**

| Metric          | Vercel Sandbox | ECS Fargate    |
| --------------- | -------------- | -------------- |
| **Floor cost**  | $20/month      | ~$100/month    |
| **At 0 users**  | $20            | $100           |
| **At 10 users** | ~$50-100       | ~$1,100        |
| **Setup time**  | 0 (deploy app) | 2-3 hours      |

### Scaling Limits

**Vercel Sandbox constraints:**

- **Timeout:** 45min (Hobby), 5hr (Pro/Enterprise)
- **Parallelism:** 50 sandboxes (soft limit, can request increase)
- **Memory:** ~4GB per sandbox
- **Storage:** Ephemeral, no persistence

**When you hit limits:**

| Symptom                         | Trigger                                | Migration Target |
| ------------------------------- | -------------------------------------- | ---------------- |
| Tasks timeout before completing | >5hr tasks common                      | ECS (12hr tasks) |
| Need >50 parallel workers       | >50 concurrent tasks                   | EKS (unlimited)  |
| Sandbox spawn latency >30s      | >100 tasks/min sustained               | EKS (warm pools) |
| Monthly cost >$500              | >10k tasks/day OR >50 daily active users | ECS (cost-efficient at scale) |

---

## Migration Triggers

### When to Stay on Vercel Sandbox

✅ **PoC/MVP phase** (getting to product-market fit)  
✅ **<50 daily active users** (1-2 teams)  
✅ **<5hr task duration** (most swarms finish in 30-60min)  
✅ **Monthly cost <$300** (team-scale budget)  
✅ **No compliance requirements** (Vercel SOC2, but not self-hosted)

### When to Migrate to ECS

**Triggers:**

- ⚠️ **>50 daily active users** (multi-team scale)
- ⚠️ **>5hr task duration** (long-running research tasks)
- ⚠️ **>50 parallel workers needed** (large swarms)
- ⚠️ **Monthly Vercel cost >$500** (ECS becomes cheaper)
- ⚠️ **Need persistent worker state** (sandboxes are ephemeral)

**Migration path:**

1. Deploy base stack (VPC, RDS, Redis, ALB) via Pulumi
2. Update adapters: point to RDS instead of Turso
3. Deploy coordinator as ECS Fargate service (always-on)
4. Deploy worker pool as ECS Fargate tasks (autoscaling)
5. Cutover DNS from Vercel to ALB
6. **Same Layer 1-3 code, zero changes**

### When to Migrate to EKS

**Triggers:**

- ⚠️ **>500 daily active users** (enterprise scale)
- ⚠️ **Need spot instances** (30% cost savings)
- ⚠️ **Need service mesh** (canary deploys, circuit breakers)
- ⚠️ **Need persistent volumes** (agent state, local caching)
- ⚠️ **Multi-region requirements** (latency optimization)

**Migration path:**

1. Deploy EKS cluster via Pulumi
2. Convert ECS task definitions to K8s deployments
3. Add Istio service mesh (optional)
4. Configure HPA (Horizontal Pod Autoscaler)
5. Set up persistent volume claims for workers
6. **Same Layer 1-3 code, zero changes**

---

## Implementation Checklist

### Phase 1: External State Setup (Week 1)

- [ ] Create Turso database for EventStore
- [ ] Create Upstash Redis for Swarm Mail
- [ ] Enable Vercel KV for Hive cache
- [ ] Set up OpenAI API key for embeddings
- [ ] Implement Redis adapter for Swarm Mail
- [ ] Implement Turso adapter for EventStore
- [ ] Implement KV adapter for Hive
- [ ] Implement OpenAI adapter for Memory
- [ ] Test adapters locally (Redis + Turso)

### Phase 2: Coordinator Workflow (Week 2)

- [ ] Create `/api/swarm/coordinator/route.ts`
- [ ] Implement 'use workflow' coordinator
- [ ] Add 'use step' for each orchestration phase
- [ ] Add `defineHook` for review gates
- [ ] Test workflow locally with Vercel CLI
- [ ] Deploy to Vercel staging
- [ ] Verify workflow survives crash/redeploy

### Phase 3: Worker Sandboxes (Week 3)

- [ ] Create `/api/swarm/worker/spawn.ts`
- [ ] Implement sandbox bootstrap (clone + install)
- [ ] Test OpenCode execution in sandbox
- [ ] Verify external state connectivity
- [ ] Test file reservation from sandbox
- [ ] Test progress reporting from sandbox
- [ ] Verify swarm_complete releases locks

### Phase 4: End-to-End Swarm (Week 4)

- [ ] Deploy full stack to Vercel production
- [ ] Run `/swarm "simple test task"` (2-3 subtasks)
- [ ] Verify N+1 pattern works
- [ ] Check Vercel dashboard observability
- [ ] Run real swarm (5-10 subtasks)
- [ ] Measure latency metrics
- [ ] Document known issues

### Phase 5: Optimization (Week 5)

- [ ] Add sandbox pooling (optional)
- [ ] Optimize coordinator step granularity
- [ ] Add retry logic for transient failures
- [ ] Implement cost tracking dashboard
- [ ] Document migration triggers
- [ ] Write runbook for ECS migration

---

## Success Metrics

| Metric                    | Target       | Measured By                      |
| ------------------------- | ------------ | -------------------------------- |
| **Coordinator spawn**     | <5s          | Vercel Workflow dashboard        |
| **Worker spawn**          | <30s         | Sandbox.create() latency         |
| **Worker overhead**       | <10%         | (setup time) / (total time)      |
| **File lock conflicts**   | <5%          | Redis reservation failures       |
| **Workflow crash recovery** | <1min      | Time to resume from last step    |
| **Cost per task**         | <$0.10       | Total monthly cost / task count  |
| **Parallel workers**      | 50+          | Concurrent sandboxes running     |

---

## Consequences

### Positive

- ✅ **Zero infrastructure setup** - Deploy swarm in <5 minutes
- ✅ **Zero floor cost** - $0 at zero usage (vs $100/month ECS)
- ✅ **Infinite scale (within limits)** - 50+ parallel workers
- ✅ **Fault-tolerant by design** - Workflow survives crashes
- ✅ **Built-in observability** - Vercel dashboard for free
- ✅ **Fast iteration** - Deploy changes in seconds
- ✅ **Standard tooling** - Workers use same `opencode` CLI
- ✅ **Escape hatch preserved** - Can migrate to ECS/EKS later

### Negative

- ⚠️ **Vercel lock-in (Layer 4 only)** - Workflow + Sandbox APIs are Vercel-specific
- ⚠️ **Timeout limits** - 5hr max (vs 12hr ECS, unlimited K8s)
- ⚠️ **Parallelism limits** - 50 sandboxes (vs unlimited EKS)
- ⚠️ **Cost at high scale** - ECS cheaper >10k tasks/day
- ⚠️ **Ephemeral workers** - No persistent state in sandboxes
- ⚠️ **Cold start latency** - Sandbox create + bootstrap ~20-30s

### Risks & Mitigations

| Risk                            | Likelihood | Impact | Mitigation                                         |
| ------------------------------- | ---------- | ------ | -------------------------------------------------- |
| **Sandbox timeout kills work**  | Medium     | High   | Checkpoint progress to Redis every 5min            |
| **Vercel API rate limits**      | Low        | Medium | Implement exponential backoff + retry              |
| **Redis connection exhaustion** | Low        | High   | Use connection pooling, limit workers to 50        |
| **Cost surprise at scale**      | Medium     | Medium | Set up billing alerts, monitor cost per task       |
| **Migration to ECS complex**    | Low        | Medium | Document migration path now, test adapters locally |

---

## Alternative Approaches Considered

### 1. ECS Fargate First (from ADR-003)

**Pros:** Production-ready, unlimited scale, no vendor lock-in  
**Cons:** $100/month floor, 2-3hr setup, slower iteration  
**Decision:** Use for post-PMF scale, not PoC

### 2. AWS Lambda + Step Functions

**Pros:** Serverless, AWS-native, mature  
**Cons:** 15min Lambda timeout, Step Functions expensive at scale, complex state machine JSON  
**Decision:** Workflow is simpler, longer timeout

### 3. Modal.com (Serverless Containers)

**Pros:** Simpler than Vercel Sandbox, GPU support  
**Cons:** Python-first (OpenCode is TypeScript), less mature, no durable orchestration  
**Decision:** Vercel integrates better with Next.js stack

### 4. Keep It Local (No Cloud)

**Pros:** Zero external dependencies, zero cost  
**Cons:** Doesn't scale beyond 1 user, no team collaboration  
**Decision:** Already works locally, need cloud for teams

---

## References

### Prior ADRs

- **[ADR-003: Swarm Control Plane](003-swarm-control-plane.md)** - Foundation architecture (Layers 1-3)
- **[ADR-001: Next.js Rebuild](001-nextjs-rebuild.md)** - Web framework choice
- **[ADR-002: Effect Migration](002-effect-migration.md)** - Effect-TS patterns

### Vercel Documentation

- **Vercel Workflow:** https://vercel.com/docs/workflow
- **Vercel Sandbox:** https://vercel.com/docs/sandbox
- **Vercel KV:** https://vercel.com/docs/storage/vercel-kv

### External Services

- **Turso (libSQL cloud):** https://turso.tech
- **Upstash Redis:** https://upstash.com
- **OpenAI Embeddings:** https://platform.openai.com/docs/guides/embeddings

### Code Locations

- **Effect Router:** `apps/web/src/core/router/`
- **Swarm Mail:** `packages/core/src/sse/`
- **Hive:** `packages/core/src/atoms/`
- **Memory:** `packages/core/src/atoms/memory/`

---

## Changelog

| Date       | Author         | Change                                                |
| ---------- | -------------- | ----------------------------------------------------- |
| 2025-12-30 | SandboxScribe  | Initial proposal for Vercel Sandbox Swarm deployment |

---

## ASCII Art: The Vision

```
    ╔═══════════════════════════════════════════════════════════════╗
    ║                                                               ║
    ║         🚀  TRIVIALLY EASY  →  INFINITELY SCALABLE  🚀        ║
    ║                                                               ║
    ╠═══════════════════════════════════════════════════════════════╣
    ║                                                               ║
    ║   PoC/MVP (Vercel Sandbox)         Post-PMF (ECS/EKS)        ║
    ║   ┌──────────────────┐             ┌──────────────────┐      ║
    ║   │  0-50 users      │             │  50-5000 users   │      ║
    ║   │  $0 floor        │ ────────▶   │  $100/mo floor   │      ║
    ║   │  0 min setup     │   migrate   │  VPC + RDS       │      ║
    ║   │  5hr timeout     │             │  12hr+ tasks     │      ║
    ║   └──────────────────┘             └──────────────────┘      ║
    ║          ▲                                  │                 ║
    ║          │                                  ▼                 ║
    ║          │                          ┌──────────────────┐      ║
    ║          │                          │  5000+ users     │      ║
    ║          └──────────────────────────│  Enterprise      │      ║
    ║                   same code         │  K8s + Istio     │      ║
    ║                   zero rewrites     └──────────────────┘      ║
    ║                                                               ║
    ║   Layers 1-3: PORTABLE (Effect Router + Swarm Mail)          ║
    ║   Layer 4: SWAPPABLE (Sandbox → ECS → EKS)                   ║
    ║                                                               ║
    ╚═══════════════════════════════════════════════════════════════╝
```

---

> "The purpose of abstraction is not to be vague, but to create a new semantic level in which one can be absolutely precise."  
> — Edsger W. Dijkstra

This ADR creates that semantic level: **Layer 4 is deployment, Layers 1-3 are logic.** Swap deployment, preserve logic. Scale from 1 user to 1000 users without rewriting the orchestration engine.
