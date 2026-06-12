package com.frontierscan.collection;

import com.frontierscan.common.api.ApiResponse;
import com.frontierscan.common.security.JwtPrincipal;
import com.frontierscan.site.SiteService;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

/**
 * 采集任务 REST 控制器。
 * <p>
 * 提供任务历史查询和手动触发采集接口。
 * 手动触发为异步执行：同步创建 RUNNING 任务记录后立即返回 202 Accepted，
 * 实际采集在后台线程中执行，前端可通过任务列表轮询状态。
 * </p>
 */
@RestController
@RequestMapping("/api/collection-runs")
public class CollectionRunController {

    private final CollectionRunService collectionRunService;
    private final CollectionOrchestrator orchestrator;
    private final SiteService siteService;

    public CollectionRunController(CollectionRunService collectionRunService,
                                   CollectionOrchestrator orchestrator,
                                   SiteService siteService) {
        this.collectionRunService = collectionRunService;
        this.orchestrator = orchestrator;
        this.siteService = siteService;
    }

    /** 查询当前用户的采集任务历史记录（按开始时间倒序）。 */
    @GetMapping
    public ApiResponse<List<CollectionRun>> list(@AuthenticationPrincipal JwtPrincipal principal) {
        return ApiResponse.ok(collectionRunService.listByUser(principal.userId()));
    }

    /**
     * 获取单个采集任务的详细信息。
     */
    @GetMapping("/{runId}")
    public ApiResponse<CollectionRun> get(@AuthenticationPrincipal JwtPrincipal principal,
                                          @PathVariable Long runId) {
        CollectionRun run = collectionRunService.getById(runId);
        if (!run.getUserId().equals(principal.userId())) {
            throw new RuntimeException("任务不存在");
        }
        return ApiResponse.ok(run);
    }

    /**
     * 重试失败的采集任务。
     * <p>
     * 只有 FAILED 状态的任务可以重试。创建新的 MANUAL 任务并异步执行，
     * 同时重置对应站点的连续失败计数。
     * </p>
     *
     * @param principal 当前认证用户
     * @param runId     失败的采集任务 ID
     * @return 202 Accepted，包含新任务记录 ID
     */
    @PostMapping("/{runId}/retry")
    public ResponseEntity<ApiResponse<Map<String, Object>>> retry(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long runId) {
        CollectionRun newRun = collectionRunService.retry(runId, principal.userId());
        return ResponseEntity.accepted().body(ApiResponse.ok(Map.of(
                "message", "采集任务已重新提交",
                "runId", newRun.getId()
        )));
    }

    /**
     * 手动触发对指定网站的采集。
     * <p>
     * 创建 RUNNING 状态的任务记录后立即返回 202 Accepted，
     * 实际采集逻辑异步执行。前端可通过 {@code GET /api/collection-runs} 轮询任务状态。
     * </p>
     *
     * @param principal 当前认证用户
     * @param siteId    目标网站 ID
     * @return 202 Accepted，包含任务记录 ID
     */
    @PostMapping("/sites/{siteId}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> trigger(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long siteId) {
        siteService.getById(principal.userId(), siteId);
        CollectionRun run = collectionRunService.create(principal.userId(), siteId, "MANUAL");
        orchestrator.executeCollection(principal.userId(), siteId, run.getId());
        return ResponseEntity.accepted().body(ApiResponse.ok(Map.of(
                "message", "采集任务已提交",
                "runId", run.getId()
        )));
    }
}
