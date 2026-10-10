package com.isabella.jdr.common;

import java.util.List;

public record PageResponse<T>(List<T> data, String nextCursor, int limit) {
}
