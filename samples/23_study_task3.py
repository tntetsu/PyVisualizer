# [Task 3] 外側のループの 2 回目（i = 1）が完了した直後、
# 配列 arr の中身はどうなっていますか？
# （最終結果ではなく、途中の状態を答えてください）

def bubble_sort(arr):
    n = len(arr)
    for i in range(n - 1):
        for j in range(n - 1 - i):
            if arr[j] > arr[j + 1]:
                temp = arr[j]
                arr[j] = arr[j + 1]
                arr[j + 1] = temp
    return arr

arr = [5, 3, 8, 1, 9]
print(bubble_sort(arr))
