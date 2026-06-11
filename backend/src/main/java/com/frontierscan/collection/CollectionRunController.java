package com.frontierscan.collection;

import com.frontierscan.common.api.ApiResponse;
import com.frontierscan.common.security.JwtPrincipal;
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

    public CollectionRunController(CollectionRunService collectionRunService,
                                   CollectionOrchestrator orchestrator) {
        this.collectionRunService = collectionRunService;
        this.orchestrator = orchestrator;
    }

    /** 查询当前用户的采集任务历史记录（按开始时间倒序）。 */
    @GetMapping
    public ApiResponse<List<CollectionRun>> list(@AuthenticationPrincipal JwtPrincipal principal) {
        return ApiResponse.ok(collectionRunService.listByUser(principal.userId()));
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
        CollectionRun run = collectionRunService.create(principal.userId(), siteId, "MANUAL");
        orchestrator.executeCollection(principal.userId(), siteId, run.getId());
        return ResponseEntity.accepted().body(ApiResponse.ok(Map.of(
                "message", "采集任务已提交",
                "runId", run.getId()
        )));
    }
}