class_name MapShapes
extends RefCounted

## Tiny 2D shape vocabulary (XZ plane) used to describe where a map is
## walkable. Shapes are plain dictionaries so map data stays serialisable and
## free of engine node types.

const TYPE_BAND := "band"
const TYPE_DISK := "disk"
const TYPE_POLY := "poly"


## A capsule-shaped corridor between two points, used for lanes and paths.
static func band(a: Vector2, b: Vector2, half_width: float) -> Dictionary:
	return {"type": TYPE_BAND, "a": a, "b": b, "hw": half_width}


static func disk(center: Vector2, radius: float) -> Dictionary:
	return {"type": TYPE_DISK, "c": center, "r": radius}


## Convex polygon, points in any winding order.
static func poly(points: PackedVector2Array) -> Dictionary:
	return {"type": TYPE_POLY, "points": points}


## Chains a polyline into a list of bands so lanes can bend around corners.
static func polyline_bands(points: PackedVector2Array, half_width: float) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for i in range(points.size() - 1):
		out.append(band(points[i], points[i + 1], half_width))
	return out


static func contains(shape: Dictionary, p: Vector2) -> bool:
	match shape.get("type", ""):
		TYPE_BAND:
			return distance_to_segment(p, shape["a"], shape["b"]) <= float(shape["hw"])
		TYPE_DISK:
			return p.distance_to(shape["c"]) <= float(shape["r"])
		TYPE_POLY:
			return Geometry2D.is_point_in_polygon(p, shape["points"])
	return false


static func contains_any(shapes: Array, p: Vector2) -> bool:
	for shape in shapes:
		if contains(shape, p):
			return true
	return false


static func distance_to_segment(p: Vector2, a: Vector2, b: Vector2) -> float:
	return p.distance_to(Geometry2D.get_closest_point_to_segment(p, a, b))


## Total length of a polyline.
static func polyline_length(points: PackedVector2Array) -> float:
	var total := 0.0
	for i in range(points.size() - 1):
		total += points[i].distance_to(points[i + 1])
	return total


## Point at [param distance] along a polyline, clamped to its ends.
static func point_along_polyline(points: PackedVector2Array, distance: float) -> Vector2:
	if points.is_empty():
		return Vector2.ZERO
	var remaining := maxf(distance, 0.0)
	for i in range(points.size() - 1):
		var seg := points[i].distance_to(points[i + 1])
		if remaining <= seg or i == points.size() - 2:
			var t: float = 0.0 if seg <= 0.0 else clampf(remaining / seg, 0.0, 1.0)
			return points[i].lerp(points[i + 1], t)
		remaining -= seg
	return points[points.size() - 1]


## Forward direction of a polyline at [param distance] along it.
static func direction_along_polyline(points: PackedVector2Array, distance: float) -> Vector2:
	var here := point_along_polyline(points, distance)
	var ahead := point_along_polyline(points, distance + 1.0)
	if here.is_equal_approx(ahead):
		ahead = point_along_polyline(points, distance - 1.0)
		return (here - ahead).normalized() if not here.is_equal_approx(ahead) else Vector2.RIGHT
	return (ahead - here).normalized()


## Shrinks a triangle so every edge moves [param margin] towards the interior.
## Uniform edge offset on a triangle is exactly a scale about the incentre.
static func inset_triangle(a: Vector2, b: Vector2, c: Vector2, margin: float) -> PackedVector2Array:
	var la := b.distance_to(c)
	var lb := a.distance_to(c)
	var lc := a.distance_to(b)
	var perimeter := la + lb + lc
	if perimeter <= 0.0:
		return PackedVector2Array([a, b, c])
	var incenter := (a * la + b * lb + c * lc) / perimeter
	var area := absf((b - a).cross(c - a)) * 0.5
	var inradius := 2.0 * area / perimeter
	var scale: float = 0.0 if inradius <= 0.0 else clampf((inradius - margin) / inradius, 0.05, 1.0)
	return PackedVector2Array([
		incenter + (a - incenter) * scale,
		incenter + (b - incenter) * scale,
		incenter + (c - incenter) * scale,
	])


static func polygon_centroid(points: PackedVector2Array) -> Vector2:
	if points.is_empty():
		return Vector2.ZERO
	var sum := Vector2.ZERO
	for p in points:
		sum += p
	return sum / float(points.size())


## Closest point on the infinite line through [param origin] with [param dir].
static func project_on_line(p: Vector2, origin: Vector2, dir: Vector2) -> Vector2:
	var d := dir.normalized()
	return origin + d * (p - origin).dot(d)


static func to_world(p: Vector2, y: float = 0.0) -> Vector3:
	return Vector3(p.x, y, p.y)


static func to_plane(p: Vector3) -> Vector2:
	return Vector2(p.x, p.z)


## Axis-aligned bounds of a shape, used to reject rasterisation samples fast.
static func shape_bounds(shape: Dictionary) -> Rect2:
	match shape.get("type", ""):
		TYPE_BAND:
			var a: Vector2 = shape["a"]
			var b: Vector2 = shape["b"]
			var hw: float = shape["hw"]
			return Rect2(a, Vector2.ZERO).expand(b).grow(hw)
		TYPE_DISK:
			var c: Vector2 = shape["c"]
			var r: float = shape["r"]
			return Rect2(c - Vector2(r, r), Vector2(r, r) * 2.0)
		TYPE_POLY:
			var points: PackedVector2Array = shape["points"]
			if points.is_empty():
				return Rect2()
			var rect := Rect2(points[0], Vector2.ZERO)
			for p in points:
				rect = rect.expand(p)
			return rect
	return Rect2()


## Pairs every shape with its bounds so callers can sample many points cheaply.
static func with_bounds(shapes: Array) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for shape in shapes:
		out.append({"shape": shape, "bounds": shape_bounds(shape)})
	return out


static func bounded_contains_any(bounded: Array, p: Vector2) -> bool:
	for entry in bounded:
		var bounds: Rect2 = entry["bounds"]
		if p.x < bounds.position.x or p.y < bounds.position.y:
			continue
		if p.x > bounds.end.x or p.y > bounds.end.y:
			continue
		if contains(entry["shape"], p):
			return true
	return false
