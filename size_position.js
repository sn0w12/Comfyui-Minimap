import { api } from "../../scripts/api.js";

// Load interact.js from CDN
const interactScript = document.createElement("script");
interactScript.src =
    "https://cdn.jsdelivr.net/npm/interactjs/dist/interact.min.js";
document.head.appendChild(interactScript);

// Initialize settings globally
let boundsSetting;
let snapTo;
let restrictToGraph;

// Reload all settings
window.addEventListener("minimap.reloadSettings", async () => {
    const settings = await api.getSettings();

    boundsSetting = settings["minimap.KeepInBounds"] ?? true;
    snapTo = settings["minimap.SnapTo"] ?? "none";
    restrictToGraph = settings["minimap.RestrictToGraph"] ?? false;

    // Send resize event to trigger ensureMinimapInBounds
    const event = new Event("resize");
    window.dispatchEvent(event);
});

interactScript.onload = () => {
    let isCtrlPressed = false;
    let resizeTimeout;

    // Listen for keydown and keyup events to track the state of the Ctrl key
    window.addEventListener("keydown", (event) => {
        if (event.key === "Control") {
            isCtrlPressed = true;
        }
    });

    window.addEventListener("keyup", (event) => {
        if (event.key === "Control") {
            isCtrlPressed = false;
        }
    });

    // Function to save minimap settings to local storage, including opacity
    function saveMinimapSettings(top, left, width, height, opacity) {
        // Store position as vh/vw values
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        // Convert absolute positions to vh/vw
        const topVh = (parseFloat(top) / windowHeight) * 100;
        const leftVw = (parseFloat(left) / windowWidth) * 100;

        const settings = {
            topVh: topVh,
            leftVw: leftVw,
            width: parseInt(width, 10),
            height: parseInt(height, 10),
            opacity: opacity,
        };
        localStorage.setItem("minimapSettings", JSON.stringify(settings));
    }

    // Function to load minimap settings from local storage
    function loadMinimapSettings() {
        const settings = localStorage.getItem("minimapSettings");
        if (settings) {
            const parsedSettings = JSON.parse(settings);

            // Handle both old px format and new vh/vw format
            if (
                parsedSettings.topVh !== undefined &&
                parsedSettings.leftVw !== undefined
            ) {
                // Convert vh/vw values to pixels for internal use
                const windowWidth = window.innerWidth;
                const windowHeight = window.innerHeight;

                parsedSettings.top =
                    (parsedSettings.topVh * windowHeight) / 100;
                parsedSettings.left =
                    (parsedSettings.leftVw * windowWidth) / 100;
            }

            return parsedSettings;
        }
        return null;
    }

    // Apply the loaded settings
    function applyMinimapSettings(miniMapElement, settings) {
        if (settings) {
            // Set position using vh/vw if available, otherwise use px
            if (settings.topVh !== undefined && settings.leftVw !== undefined) {
                miniMapElement.style.top = `${settings.topVh}vh`;
                miniMapElement.style.left = `${settings.leftVw}vw`;
            } else {
                miniMapElement.style.top = `${settings.top}px`;
                miniMapElement.style.left = `${settings.left}px`;
            }
            // Width and height remain in px as requested
            miniMapElement.style.width = `${settings.width}px`;
            miniMapElement.style.height = `${settings.height}px`;
            miniMapElement.style.opacity = settings.opacity;
        }
    }

    function getComfyPadding() {
        const topPadding = restrictToGraph
            ? window.app?.bodyTop?.clientHeight || 0
            : 0;
        const bottomPadding = restrictToGraph
            ? window.app?.bodyBottom?.clientHeight || 0
            : 0;
        const leftPadding = restrictToGraph
            ? window.app?.bodyLeft?.clientWidth || 0
            : 0;
        const rightPadding = restrictToGraph
            ? window.app?.bodyRight?.clientWidth || 0
            : 0;

        const clientWidth = window.app.canvas.canvas.clientWidth;
        const clientHeight = window.app.canvas.canvas.clientHeight;

        // If the padding is larger than the client size, return 0 padding
        if (leftPadding >= clientWidth || rightPadding >= clientWidth) {
            return [0, 0, 0, 0];
        }
        if (topPadding >= clientHeight || bottomPadding >= clientHeight) {
            return [0, 0, 0, 0];
        }

        return [topPadding, bottomPadding, leftPadding, rightPadding];
    }

    // Wait for the #minimap to be injected into the DOM
    function waitForMinimap() {
        const interval = setInterval(() => {
            const miniMapElement = document.getElementById("minimap");
            if (miniMapElement) {
                clearInterval(interval);
                const settings = loadMinimapSettings();
                applyMinimapSettings(miniMapElement, settings);
                makeDraggable(miniMapElement);
                makeResizable(miniMapElement);
                makeScrollable(miniMapElement); // Add scroll handling for opacity
                ensureMinimapInBounds(miniMapElement); // Make sure minimap is in bounds

                window.addEventListener("resize", function () {
                    if (resizeTimeout) {
                        clearTimeout(resizeTimeout);
                    }

                    resizeTimeout = setTimeout(function () {
                        if (boundsSetting != false || snapTo != "none") {
                            ensureMinimapInBounds(miniMapElement); // Ensure minimap stays within the window
                        }
                    }, 200);
                });
            }
        }, 500);
    }

    // Function to make the #minimap draggable and confined within the window
    function makeDraggable(miniMapElement) {
        const position = { x: 0, y: 0 };

        miniMapElement.classList.add("draggable");

        interact("#minimap").draggable({
            listeners: {
                start(event) {
                    if (!isCtrlPressed) {
                        return event.interaction.stop(); // Prevent dragging if Ctrl is not held down
                    }

                    // Get current position (converting from vh/vw to px if needed)
                    const currentLeft = miniMapElement.style.left;
                    const currentTop = miniMapElement.style.top;

                    if (currentLeft.includes("vw")) {
                        position.x =
                            (parseFloat(currentLeft) * window.innerWidth) / 100;
                    } else {
                        position.x = parseFloat(currentLeft) || 0;
                    }

                    if (currentTop.includes("vh")) {
                        position.y =
                            (parseFloat(currentTop) * window.innerHeight) / 100;
                    } else {
                        position.y = parseFloat(currentTop) || 0;
                    }
                },
                move(event) {
                    const [
                        topPadding,
                        bottomPadding,
                        leftPadding,
                        rightPadding,
                    ] = getComfyPadding();

                    position.x += event.dx;
                    position.y += event.dy;

                    const windowWidth =
                        window.innerWidth - miniMapElement.offsetWidth;
                    const windowHeight =
                        window.innerHeight - miniMapElement.offsetHeight;

                    const maxX = windowWidth - rightPadding;
                    const maxY = windowHeight - bottomPadding;
                    const minX = leftPadding;
                    const minY = topPadding;

                    position.x = Math.max(minX, Math.min(position.x, maxX));
                    position.y = Math.max(minY, Math.min(position.y, maxY));

                    // Convert to vh/vw
                    const topVh = (position.y / window.innerHeight) * 100;
                    const leftVw = (position.x / window.innerWidth) * 100;

                    miniMapElement.style.left = `${leftVw}vw`;
                    miniMapElement.style.top = `${topVh}vh`;

                    // Save the new position to the settings
                    const opacity =
                        parseFloat(miniMapElement.style.opacity) || 1;
                    saveMinimapSettings(
                        position.y,
                        position.x,
                        miniMapElement.offsetWidth,
                        miniMapElement.offsetHeight,
                        opacity
                    );
                },
                end(event) {},
            },
            cursorChecker(action) {
                // Only show the move cursor if Ctrl is pressed
                if (isCtrlPressed) {
                    return "move";
                }
                return null;
            },
        });
    }

    // Function to make the #minimap resizable
    function makeResizable(miniMapElement) {
        interact("#minimap").resizable({
            edges: { left: true, right: true, bottom: true, top: true },
            listeners: {
                start(event) {
                    if (!isCtrlPressed) {
                        return event.interaction.stop(); // Prevent resizing if Ctrl is not held down
                    }
                },
                move(event) {
                    let { x, y } = event.target.getBoundingClientRect();

                    const { width, height } = event.rect;

                    // Adjust position when resizing from the left or top edges
                    if (event.edges.left) {
                        x += event.deltaRect.left;
                        // Convert to vw
                        const leftVw = (x / window.innerWidth) * 100;
                        miniMapElement.style.left = `${leftVw}vw`;
                    }
                    if (event.edges.top) {
                        y += event.deltaRect.top;
                        // Convert to vh
                        const topVh = (y / window.innerHeight) * 100;
                        miniMapElement.style.top = `${topVh}vh`;
                    }

                    // Width and height remain in px as requested
                    miniMapElement.style.width = `${width}px`;
                    miniMapElement.style.height = `${height}px`;

                    // Update the size of the canvas inside the minimap
                    const miniGraphCanvas =
                        miniMapElement.querySelector("canvas");
                    miniGraphCanvas.width = width;
                    miniGraphCanvas.height = height;

                    // Save the new size and position to the settings
                    const opacity =
                        parseFloat(miniMapElement.style.opacity) || 1;
                    saveMinimapSettings(y, x, width, height, opacity);
                },
            },
            modifiers: [
                interact.modifiers.restrictSize({
                    min: { width: 100, height: 60 },
                    max: {
                        width: window.innerWidth,
                        height: window.innerHeight,
                    },
                }),
            ],
            cursorChecker(action, interactable, element, interacting) {
                // Show appropriate resize cursor based on the edge being interacted with
                if (isCtrlPressed) {
                    if (
                        (action.edges.left && action.edges.top) ||
                        (action.edges.right && action.edges.bottom)
                    ) {
                        return "nwse-resize"; // Top-left or bottom-right corners
                    } else if (
                        (action.edges.right && action.edges.top) ||
                        (action.edges.left && action.edges.bottom)
                    ) {
                        return "nesw-resize"; // Top-right or bottom-left corners
                    } else if (action.edges.left || action.edges.right) {
                        return "ew-resize"; // Horizontal resize
                    } else if (action.edges.top || action.edges.bottom) {
                        return "ns-resize"; // Vertical resize
                    }
                }
                return null;
            },
        });
    }

    // Function to handle scrolling for opacity change
    function makeScrollable(miniMapElement) {
        miniMapElement.addEventListener("wheel", function (event) {
            if (isCtrlPressed) {
                event.preventDefault(); // Prevent default scroll action
                let opacity = parseFloat(miniMapElement.style.opacity) || 1;
                opacity += event.deltaY * -0.001; // Adjust the opacity based on scroll direction
                opacity = Math.min(Math.max(opacity, 0.1), 1); // Constrain opacity between 0.1 and 1
                miniMapElement.style.opacity = opacity;

                // Save the new opacity to the settings
                // Get current position and convert to pixels if needed
                const currentTop = miniMapElement.style.top;
                const currentLeft = miniMapElement.style.left;
                const windowWidth = window.innerWidth;
                const windowHeight = window.innerHeight;

                let topPx, leftPx;

                if (currentTop.includes("vh")) {
                    topPx = (parseFloat(currentTop) * windowHeight) / 100;
                } else {
                    topPx = parseFloat(currentTop) || 0;
                }

                if (currentLeft.includes("vw")) {
                    leftPx = (parseFloat(currentLeft) * windowWidth) / 100;
                } else {
                    leftPx = parseFloat(currentLeft) || 0;
                }

                const width = parseFloat(miniMapElement.style.width);
                const height = parseFloat(miniMapElement.style.height);
                saveMinimapSettings(topPx, leftPx, width, height, opacity);
            }
        });
    }

    function calculateSnappedMinimapPosition(miniMapElement, miniMapRect) {
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        // Get padding so we don't overlap with the new UI
        const [topPadding, bottomPadding, leftPadding, rightPadding] =
            getComfyPadding();

        // Get current position values and convert to pixels if they are in vh/vw
        let currentTop = miniMapElement.style.top;
        let currentLeft = miniMapElement.style.left;

        let newTopPx = currentTop.includes("vh")
            ? (parseFloat(currentTop) * windowHeight) / 100
            : parseFloat(currentTop);

        let newLeftPx = currentLeft.includes("vw")
            ? (parseFloat(currentLeft) * windowWidth) / 100
            : parseFloat(currentLeft);

        switch (snapTo) {
            case "topleft":
                newTopPx = topPadding;
                newLeftPx = leftPadding;
                break;
            case "topright":
                newTopPx = topPadding;
                newLeftPx = windowWidth - miniMapRect.width - rightPadding;
                break;
            case "bottomleft":
                newTopPx = windowHeight - miniMapRect.height - bottomPadding;
                newLeftPx = leftPadding;
                break;
            case "bottomright":
                newTopPx = windowHeight - miniMapRect.height - bottomPadding;
                newLeftPx = windowWidth - miniMapRect.width - rightPadding;
                break;
            case "none":
                break;
            default:
                console.warn(`Invalid snapTo value: ${snapTo}`);
                break;
        }

        // Keep in bounds
        if (boundsSetting) {
            if (miniMapRect.top < topPadding) {
                newTopPx = topPadding;
            } else if (miniMapRect.bottom > windowHeight) {
                newTopPx = windowHeight - miniMapRect.height + topPadding;
            }

            if (miniMapRect.left < leftPadding) {
                newLeftPx = leftPadding;
            } else if (miniMapRect.right > windowWidth) {
                newLeftPx = windowWidth - miniMapRect.width - rightPadding;
            }
        }

        // Convert to vh/vw
        const newTopVh = (newTopPx / windowHeight) * 100;
        const newLeftVw = (newLeftPx / windowWidth) * 100;

        return [newTopVh, newLeftVw];
    }

    function ensureMinimapInBounds(miniMapElement) {
        const miniMapRect = miniMapElement.getBoundingClientRect();
        let [newTopVh, newLeftVw] = calculateSnappedMinimapPosition(
            miniMapElement,
            miniMapRect
        );

        miniMapElement.style.top = `${newTopVh}vh`;
        miniMapElement.style.left = `${newLeftVw}vw`;

        // Save the settings after adjusting the position
        const width = parseFloat(miniMapElement.style.width);
        const height = parseFloat(miniMapElement.style.height);
        const opacity = parseFloat(miniMapElement.style.opacity) || 1;

        // Convert vh/vw back to px for internal calculations in saveMinimapSettings
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;
        const topPx = (newTopVh * windowHeight) / 100;
        const leftPx = (newLeftVw * windowWidth) / 100;

        saveMinimapSettings(topPx, leftPx, width, height, opacity);
    }

    waitForMinimap();
};
