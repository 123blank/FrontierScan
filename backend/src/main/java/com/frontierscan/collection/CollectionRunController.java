package com.frontierscan.collection;

import com.frontierscan.common.api.ApiResponse;
import com.frontierscan.common.security.JwtPrincipal;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 采集任务 REST 控制器。
 * <p>
 * 提供任务历史查询和手动触发采集接口。
 * 手动采集由前端触发，后端创建 RUNNING 状态的任务记录后返回，
 * 实际的采集逻辑将在后续迭代中实现（RSS 解析 + LLM 摘要）。
 * </p>
 */
@RestController
@RequestMapping("/api/collection-runs")
public class CollectionRunController {

    private final CollectionRunService collectionRunService;

    public CollectionRunController(CollectionRunService collectionRunService) {
        this.collectionRunService = collectionRunService;
    }

    /** 查询当前用户的采集任务历史记录。 */
    @GetMapping
    public ApiResponse<List<CollectionRun>> list(@AuthenticationPrincipal JwtPrincipal principal) {
        return ApiResponse.ok(collectionRunService.listByUser(principal.userId()));
    }

    /** 手动触发对指定网站的采集。 */
    @PostMapping("/sites/{siteId}")
    public ApiResponse<CollectionRun> trigger(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long siteId
    ) {
        CollectionRun run = collectionRunService.create(principal.userId(), siteId, "MANUAL");
        return ApiResponse.ok(run);
    }
}