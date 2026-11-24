def insert(tree, value):
    if tree is None:
        return {"value": value, "left": None, "right": None}
    if value < tree["value"]:
        tree["left"] = insert(tree["left"], value)
    else:
        tree["right"] = insert(tree["right"], value)
    return tree

def search(tree, value):
    if tree is None:
        return False
    if tree["value"] == value:
        return True
    if value < tree["value"]:
        return search(tree["left"], value)
    return search(tree["right"], value)

tree = None
for v in [5, 3, 8, 1, 4]:
    tree = insert(tree, v)
print(search(tree, 4))
