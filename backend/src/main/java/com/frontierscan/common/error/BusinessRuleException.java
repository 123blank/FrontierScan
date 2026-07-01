package com.frontierscan.common.error;

/**
 * Raised when a syntactically valid request violates a domain rule.
 */
public class BusinessRuleException extends RuntimeException {

    public BusinessRuleException(String message) {
        super(message);
    }
}
