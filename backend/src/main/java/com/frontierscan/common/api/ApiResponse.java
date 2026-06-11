package com.frontierscan.common.api;

import java.time.Instant;

/**
 * 统一 API 响应封装。
 * <p>
 * 所有 REST 接口统一使用此包装返回，确保客户端能通过 {@code success} 字段快速判断请求状态。
 * 成功时 {@code data} 携带业务数据，失败时 {@code message} 描述错误原因。
 * </p>
 *
 * @param <T> 响应数据类型
 */
public record ApiResponse<T>(
        /** 请求是否成功 */
        boolean success,
        /** 成功时的业务数据 */
        T data,
        /** 响应消息（成功时通常为 "ok"，失败时为错误描述） */
        String message,
        /** 服务器响应时间戳 */
        Instant timestamp
) {
    /**
     * 创建成功响应。
     *
     * @param data 业务数据
     * @param <T>  数据类型
     * @return 成功响应对象
     */
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, data, "ok", Instant.now());
    }

    /**
     * 创建失败响应。
     *
     * @param message 错误描述
     * @param <T>     数据类型
     * @return 失败响应对象
     */
    public static <T> ApiResponse<T> error(String message) {
        return new ApiResponse<>(false, null, message, Instant.now());
    }
}