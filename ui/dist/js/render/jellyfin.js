import { api } from "../data/api.js";
import { $, el } from "../lib/dom.js";
import { toast } from "../toast.js";
import { icons } from "../icons.js";
import { t, tNode } from "../i18n.js";
import { createStationManager } from "./stationManager.js";

/**
 * Creates a default station object structure.
 *
 * @param {string} name - The name of the station
 * @returns {object} The new station instance { name, target_type, playlist_id, use_favorites }
 */
function newStation(name) {
    return { name, target_type: "playlist", playlist_id: "", use_favorites: false };
}

/**
 * Renders and manages the Jellyfin station source UI component.
 * Integrates with the shared StationManager for CRUD operations and track queues.
 *
 * @param {HTMLElement} main - The main container element to inject the card into
 * @param {object} ctx - Application context containing state and lifecycle hooks
 * @param {() => object} ctx.getState - Returns the global application state
 * @param {() => Promise<void>} [ctx.onSaved] - Optional callback triggered after successful mutations
 */
export function createJellyfin(main, ctx) {
    const typeSelect = el("select", { class: "path-input" }, [
        el("option", { value: "playlist", dataset: { i18n: "jellyfin.type.playlist" } }, t("jellyfin.type.playlist") || "Playlist"),
        el("option", { value: "album", dataset: { i18n: "jellyfin.type.album" } }, t("jellyfin.type.album") || "Album"),
        el("option", { value: "artist", dataset: { i18n: "jellyfin.type.artist" } }, t("jellyfin.type.artist") || "Artist"),
        el("option", { value: "favorites", dataset: { i18n: "jellyfin.type.favorites" } }, t("jellyfin.type.favorites") || "Favorites"),
    ]);

    const itemSelect = el("select", { class: "path-input" });

    const castBtn = el("button", { type: "button", class: "btn ghost", dataset: { i18n: "btn.cast" } }, t("btn.cast"));
    const saveBtn = el("button", { type: "button", class: "btn filled", dataset: { i18n: "btn.save" } }, t("btn.save"));
    const shuffleBtn = el("button", {
        type: "button", class: "icon-btn", "aria-label": t("jellyfin.toggle_shuffle"),
        dataset: { i18nAriaLabel: "jellyfin.toggle_shuffle" }, html: icons.shuffle,
    });
    const summaryEl = el("p", { class: "muted", hidden: true });
    let lastDetails = null;

    let isLoadingDirectory = false;
    let loadedType = null;

    async function refreshItems() {
        const type = typeSelect.value;
        if (type === "favorites") {
            itemSelect.innerHTML = "";
            itemSelect.appendChild(el("option", { value: "favorites", selected: true, dataset: { i18n: "jellyfin.all_favorites" } }, t("jellyfin.all_favorites") || "All Favorites"));
            itemSelect.disabled = true;
            loadedType = type;
            return;
        }
        itemSelect.disabled = false;

        if (isLoadingDirectory) return;
        if (loadedType === type && itemSelect.options.length > 1) return;

        isLoadingDirectory = true;
        itemSelect.innerHTML = "";
        const loadingOpt = el("option", { disabled: true, selected: true, dataset: { i18n: "label.loading" } }, t("label.loading"));
        itemSelect.appendChild(loadingOpt);
        
        try {
            const data = await api.jellyfin.getDirectory(type);
            itemSelect.innerHTML = "";
            if (!data || data.length === 0) {
                itemSelect.appendChild(el("option", { disabled: true, selected: true, dataset: { i18n: "label.no_matches" } }, t("label.no_matches")));
                loadedType = type;
                return;
            }
            
            for (const item of data) {
                let text = item.title;
                itemSelect.appendChild(el("option", { value: item.key }, text));
            }
            
            loadedType = type;
            // re-select if possible
            if (station.cur() && station.cur().target_type === type && station.cur().playlist_id) {
                itemSelect.value = station.cur().playlist_id;
            }
        } catch (e) {
            itemSelect.innerHTML = "";
            itemSelect.appendChild(el("option", { disabled: true, selected: true }, "Error loading items"));
            loadedType = null;
        } finally {
            isLoadingDirectory = false;
        }
    }

    typeSelect.addEventListener("change", refreshItems);

    function renderSummary() {
        const s = station.cur();
        if (!s) {
            summaryEl.hidden = true;
            return;
        }
        const isOnAir = s.name === station.getActiveStation();
        const trackCount = isOnAir ? lastDetails?.queue_size : null;

        const parts = [`${stationSelect.options.length} ${t("label.stations")}`];
        if (trackCount != null) parts.unshift(`${trackCount} ${t("label.tracks")}`);

        summaryEl.textContent = parts.join(" · ");
        summaryEl.hidden = false;
    }

    const station = createStationManager({
        api: api.jellyfin,
        newStation,
        defaultNameKey: "jellyfin.default_station_name",
        ctx,
        queue: {
            getTitle: track => track.title,
            getSubtitle: track => track.artist || null,
            getCoverUrl: track => track.cover_url,
            getSearchFields: track => [track.title || "", track.artist || ""],
        },
        getSig: details => `${details?.queue_size ?? -1}|${details?.queue_cursor ?? -1}`,
        onAir: async () => {
            await api.switchSource("jellyfin");
            await api.transport("jellyfin", "play");
        },
        onStationChange: s => {
            const newType = s?.target_type || (s?.use_favorites ? "favorites" : "playlist");
            typeSelect.value = newType;
            if (loadedType !== newType) {
                refreshItems();
            } else {
                itemSelect.value = s?.playlist_id || "";
            }
            renderSummary();
        },
        onSync: details => {
            lastDetails = details;
            const shuffleOn = !!details?.shuffle;
            shuffleBtn.classList.toggle("toggled", shuffleOn);
            shuffleBtn.setAttribute("aria-pressed", String(shuffleOn));
            renderSummary();
        },
    });

    const { stationSelect, onAirBtn, newBtn, duplicateBtn, renameBtn, deleteBtn, queueCount, searchInput, trackList } = station.els;

    const card = el("section", { class: "card", id: "jellyfin-card", hidden: true }, [
        el("h2", { dataset: { i18n: "jellyfin.title" } }, t("jellyfin.title")),
        summaryEl,
        el("div", { class: "stationbar row" }, [stationSelect, onAirBtn]),
        el("div", { class: "row stationtools" }, [newBtn, duplicateBtn, renameBtn, deleteBtn]),
        el("div", { class: "editor" }, [
            el("label", { class: "field-label", dataset: { i18n: "jellyfin.target_type" } }, t("jellyfin.target_type") || "Type"),
            typeSelect,
            el("label", { class: "field-label", dataset: { i18n: "jellyfin.target_item" } }, t("jellyfin.target_item") || "Item"),
            itemSelect,
            el("div", { class: "row editor-foot" }, [castBtn, saveBtn]),
        ]),
        el("div", { class: "queue" }, [
            el("div", { class: "queue-head row" }, [el("label", { class: "field-label", dataset: { i18n: "label.queue" } }, t("label.queue")), queueCount, shuffleBtn]),
            searchInput,
            trackList,
        ]),
    ]);

    const sourcesCard = $("#sources", main)?.closest(".card");
    if (sourcesCard) sourcesCard.insertAdjacentElement("afterend", card);
    else main.append(card);

    saveBtn.addEventListener("click", async () => {
        if (station.cur()) {
            station.cur().target_type = typeSelect.value;
            station.cur().playlist_id = itemSelect.value;
        }
        try {
            await station.save();
            toast(t("jellyfin.stations_saved"));
        } catch {
            // Error handling already deferred to the station manager
        }
    });

    castBtn.addEventListener("click", async () => {
        const type = typeSelect.value;
        const id = itemSelect.value;
        if (type !== "favorites" && !id) return;
        typeSelect.disabled = true;
        itemSelect.disabled = true;
        castBtn.disabled = true;
        try {
            await api.jellyfin.cast(type, id);
            toast(t("toast.casting", { service: "Jellyfin" }));
            await ctx.onSaved?.();
            station.loadQueue();
        } catch (e) {
            toast(e.message, true);
        } finally {
            typeSelect.disabled = false;
            if (typeSelect.value !== "favorites") itemSelect.disabled = false;
            castBtn.disabled = false;
        }
    });

    shuffleBtn.addEventListener("click", async () => {
        const isShuffled = shuffleBtn.classList.contains("toggled");
        try {
            await api.jellyfin.shuffle(!isShuffled);
            toast(!isShuffled ? t("toast.shuffle_on") : t("toast.shuffle_off"));
            await ctx.onSaved?.();
            station.loadQueue();
        } catch (e) {
            toast(e.message, true);
        }
    });

    function render() {
        const state = ctx.getState();
        const isActive = state?.sources?.active === "jellyfin";
        card.hidden = !isActive;
        if (!isActive) return;
        station.load();
        const details = state?.sources?.available?.find(s => s.name === "jellyfin")?.details;
        station.sync(details);

        // ensure options are loaded if active
        if (loadedType !== typeSelect.value) {
            refreshItems();
        }
    }

    return { render, invalidate: station.invalidate };
}