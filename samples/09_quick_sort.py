def quick_sort(arr, lo, hi):
    if lo >= hi:
        return arr
    pivot = arr[hi]
    i = lo
    for j in range(lo, hi):
        if arr[j] <= pivot:
            arr[i], arr[j] = arr[j], arr[i]
            i += 1
    arr[i], arr[hi] = arr[hi], arr[i]
    quick_sort(arr, lo, i - 1)
    quick_sort(arr, i + 1, hi)
    return arr

data = [5, 3, 8, 1, 2, 7, 4]
print(quick_sort(data, 0, len(data) - 1))
