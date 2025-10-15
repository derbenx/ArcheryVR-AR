extends XROrigin3D

@onready var left_controller: XRController3D = $LeftController
@onready var right_controller: XRController3D = $RightController

var webxr_interface: WebXRInterface

# A placeholder mesh for the bow.
var bow_placeholder: MeshInstance3D

func _ready() -> void:
	# Find the WebXR interface.
	webxr_interface = XRServer.find_interface("WebXR")
	if webxr_interface:
		# Connect signals for session management.
		webxr_interface.session_started.connect(_on_webxr_session_started)
		webxr_interface.session_ended.connect(_on_webxr_session_ended)
		webxr_interface.session_failed.connect(_on_webxr_session_failed)

		# Connect controller signals, binding the controller node to the handler.
		left_controller.button_pressed.connect(_on_button_pressed.bind(left_controller))
		right_controller.button_pressed.connect(_on_button_pressed.bind(right_controller))
		left_controller.button_released.connect(_on_button_released.bind(left_controller))
		right_controller.button_released.connect(_on_button_released.bind(right_controller))

		# Create a placeholder for the bow and keep it hidden.
		bow_placeholder = MeshInstance3D.new()
		bow_placeholder.mesh = BoxMesh.new()
		bow_placeholder.scale = Vector3(0.1, 0.5, 0.1) # Approximate bow size
		bow_placeholder.visible = false
		add_child(bow_placeholder)
	else:
		printerr("WebXR interface not found.")

func _on_webxr_session_started() -> void:
	print("WebXR session started.")
	# Set the reference space to local-floor for AR.
	webxr_interface.set_reference_space_type("local-floor")

func _on_webxr_session_ended() -> void:
	print("WebXR session ended.")

func _on_webxr_session_failed(message: String) -> void:
	printerr("WebXR session failed: ", message)

func _on_button_pressed(button_name: String, controller: XRController3D) -> void:
	if button_name == "grip_click":
		# Show the bow placeholder on the controller that pressed the grip.
		bow_placeholder.reparent(controller)
		bow_placeholder.transform = Transform3D.IDENTITY
		bow_placeholder.visible = true

func _on_button_released(button_name: String, controller: XRController3D) -> void:
	if button_name == "grip_click":
		# Hide the bow placeholder when the grip is released.
		if bow_placeholder.get_parent() == controller:
			bow_placeholder.visible = false
			bow_placeholder.reparent(self)