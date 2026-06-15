package com.frontierscan.llm;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import java.util.List;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link SummaryMapReduceService} 长文摘要编排测试。
 * <p>
 * 重点验证分块、overlap、map/reduce 调用顺序以及部分分块失败时的兜底行为，
 * 确保全文摘要不会退化成仅对列表片段做总结。
 * </p>
 */
@ExtendWith(MockitoExtension.class)
@DisplayName("SummaryMapReduceService 长文摘要编排")
class SummaryMapReduceServiceTest {

    @Mock
    private LlmProvider llmProvider;

    private final CountingExecutor mapReduceExecutor = new CountingExecutor();

    @Test
    @DisplayName("短文不分块，直接走单次摘要")
    void shouldBypassMapReduceForShortContent() {
        LlmProperties properties = new LlmProperties(
                null, null, null, null,
                new LlmProperties.SummaryMapReduceProperties(true, 200, 20, 0),
                new LlmProperties.TagProperties(8000));
        SummaryMapReduceService service = new SummaryMapReduceService(llmProvider, properties, mapReduceExecutor);
        when(llmProvider.summarize(any())).thenReturn(new SummaryResult(
                "标题", "摘要", List.of("要点1", "要点2"), List.of("标签1")));

        SummaryResult result = service.summarize(new SummaryRequest(
                "标题", "https://example.com/a",
                "这是一段较短的正文内容，直接单次摘要即可。"));

        assertThat(result.summary()).isEqualTo("摘要");
        verify(llmProvider, times(1)).summarize(any());
    }

    @Test
    @DisplayName("长文按分块并保留 overlap")
    void shouldSplitLongContentWithOverlap() {
        LlmProperties properties = new LlmProperties(
                null, null, null, null,
                new LlmProperties.SummaryMapReduceProperties(true, 40, 10, 0),
                new LlmProperties.TagProperties(8000));
        SummaryMapReduceService service = new SummaryMapReduceService(llmProvider, properties, mapReduceExecutor);
        when(llmProvider.summarize(any())).thenReturn(new SummaryResult(
                "标题", "摘要", List.of("要点1", "要点2"), List.of("标签1")));

        String content = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz";
        List<String> chunks = service.splitContent(content, 40, 10, 0);
        service.summarize(new SummaryRequest("标题", "https://example.com/a", content));

        ArgumentCaptor<SummaryRequest> captor = ArgumentCaptor.forClass(SummaryRequest.class);
        verify(llmProvider, times(chunks.size() + 1)).summarize(captor.capture());
        List<SummaryRequest> requests = captor.getAllValues();

        assertThat(chunks).hasSizeGreaterThan(1);
        assertThat(mapReduceExecutor.submittedCount()).isEqualTo(chunks.size());
        assertThat(chunks.get(1)).startsWith(chunks.get(0).substring(chunks.get(0).length() - 10));
        assertThat(requests.get(0).content()).contains("第 1/" + chunks.size() + " 个分块");
        assertThat(requests.get(chunks.size()).content()).contains("分块 1");
    }

    @Test
    @DisplayName("分块失败时抛出异常阻止不完整摘要")
    void shouldFailWhenAnyChunkFails() {
        LlmProperties properties = new LlmProperties(
                null, null, null, null,
                new LlmProperties.SummaryMapReduceProperties(true, 20, 5, 0),
                new LlmProperties.TagProperties(8000));
        SummaryMapReduceService service = new SummaryMapReduceService(llmProvider, properties, mapReduceExecutor);
        when(llmProvider.summarize(any()))
                .thenReturn(new SummaryResult("标题", "摘要", List.of("要点1", "要点2"), List.of("标签1")))
                .thenReturn(null);

        assertThrows(SummaryMapReduceException.class, () ->
                service.summarize(new SummaryRequest(
                        "标题", "https://example.com/a",
                        "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")));
    }

    /**
     * 测试用同步 Executor。
     * <p>生产环境使用真实线程池并行执行；单元测试用同步执行器降低不确定性，同时记录提交次数验证分块确实进入 executor。</p>
     */
    private static class CountingExecutor implements Executor {
        private final AtomicInteger submittedCount = new AtomicInteger();

        @Override
        public void execute(Runnable command) {
            submittedCount.incrementAndGet();
            command.run();
        }

        int submittedCount() {
            return submittedCount.get();
        }
    }
}
