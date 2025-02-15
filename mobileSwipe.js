// mobileSwipe.js

document.addEventListener("DOMContentLoaded", function () {
    const swipeElement = document.querySelector(".swipe-area"); // Change selector as needed

    let startX = 0;
    let startY = 0;

    // Touch start event
    swipeElement.addEventListener("touchstart", function (e) {
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
    });

    // Touch move event
    swipeElement.addEventListener("touchmove", function (e) {
        const touch = e.touches[0];
        const deltaX = touch.clientX - startX;
        const deltaY = touch.clientY - startY;

        // Determine if it's a horizontal swipe
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            if (deltaX > 50) {
                console.log("Swipe Right");
                // Custom logic for swipe right
            } else if (deltaX < -50) {
                console.log("Swipe Left");
                // Custom logic for swipe left
            }
        } else {
            if (deltaY > 50) {
                console.log("Swipe Down");
                // Custom logic for swipe down
            } else if (deltaY < -50) {
                console.log("Swipe Up");
                // Custom logic for swipe up
            }
        }
    });
});
