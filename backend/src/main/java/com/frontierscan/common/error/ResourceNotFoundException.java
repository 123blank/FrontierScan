package com.frontierscan.common.error;

/**
 * 业务资源不存在异常。
 * <p>
 * 用于表示当前用户访问的资源不存在，或资源存在但不属于当前用户。
 * 对外统一返回 404，避免通过响应差异泄露其他用户资源是否存在。
 * </p>
 */
public class ResourceNotFoundException extends RuntimeException {

    /**
     * 创建资源不存在异常。
     *
     * @param message 面向调用方的错误信息
     */
    public ResourceNotFoundException(String message) {
        super(message);
    }
}
