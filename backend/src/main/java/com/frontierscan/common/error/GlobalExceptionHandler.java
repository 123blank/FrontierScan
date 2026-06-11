package com.frontierscan.common.error;

import com.frontierscan.common.api.ApiResponse;
import jakarta.validation.ConstraintViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 全局异常处理器。
 * <p>
 * 将应用中未处理的异常统一转换为 {@link ApiResponse} 格式返回，
 * 避免将原始异常栈信息暴露给客户端。覆盖校验异常、参数异常和通用异常三种场景。
 * </p>
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    /**
     * 处理请求体参数校验失败异常。
     *
     * @param exception {@link MethodArgumentNotValidException}
     * @return 400 Bad Request，包含第一个校验失败的字段名和错误信息
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException exception) {
        String message = exception.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(error -> error.getField() + " " + error.getDefaultMessage())
                .orElse("Invalid request");
        return ResponseEntity.badRequest().body(ApiResponse.error(message));
    }

    /**
     * 处理路径参数或查询参数约束校验失败异常。
     *
     * @param exception {@link ConstraintViolationException}
     * @return 400 Bad Request
     */
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<ApiResponse<Void>> handleConstraint(ConstraintViolationException exception) {
        return ResponseEntity.badRequest().body(ApiResponse.error(exception.getMessage()));
    }

    /**
     * 处理未预期的通用异常（兜底处理）。
     *
     * @param exception {@link Exception}
     * @return 500 Internal Server Error，不暴露具体错误详情
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception exception) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error("Unexpected server error"));
    }
}