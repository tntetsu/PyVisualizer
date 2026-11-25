def node(val, next_node=None):
    return {"val": val, "next": next_node}

def prepend(lst, val):
    return node(val, lst)

def to_list(lst):
    result = []
    cur = lst
    while cur is not None:
        result.append(cur["val"])
        cur = cur["next"]
    return result

linked = None
linked = prepend(linked, 3)
linked = prepend(linked, 2)
linked = prepend(linked, 1)
print(to_list(linked))
