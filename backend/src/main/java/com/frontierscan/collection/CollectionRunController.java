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
import java.util.Map;

@RestController
@RequestMapping("/api/collection-runs")
public class CollectionRunController {

    private final CollectionRunService collectionRunService;

    public CollectionRunController(CollectionRunService collectionRunService) {
        this.collectionRunService = collectionRunService;
    }

    @GetMapping
    public ApiResponse<List<CollectionRun>> list(@AuthenticationPrincipal JwtPrincipal principal) {
        return ApiResponse.ok(collectionRunService.listByUser(principal.userId()));
    }

    @PostMapping("/sites/{siteId}")
    public ApiResponse<CollectionRun> trigger(
            @AuthenticationPrincipal JwtPrincipal principal,
            @PathVariable Long siteId
    ) {
        CollectionRun run = collectionRunService.create(principal.userId(), siteId, "MANUAL");
        return ApiResponse.ok(run);
    }
}
