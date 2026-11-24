def selection_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        min_idx = i
        for k in range(i + 1, n):
            if arr[k] < arr[min_idx]:
                min_idx = k
        arr[i], arr[min_idx] = arr[min_idx], arr[i]
    return arr

print(selection_sort([6, 5, 4, 1, 0, 2, 3]))
