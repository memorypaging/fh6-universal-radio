import { api } from "../data/api.js";
import { $, el } from "../lib/dom.js";
import { toast } from "../toast.js";
import { icons } from "../icons.js";
import { t } from "../i18n.js";
import { createStationManager } from "./stationManager.js";

function newStation(name) {
    return { name, target_type: "playlist", playlist_id: "" };
}

export function createPlex(main, ctx) {
    const typeSelect = el("select", { class: "path-input" }, [
        el("option", { value: "playlist", dataset: { i18n: "plex.type.playlist" } }, t("plex.type.playlist") || "Playlist"),
        el("option", { value: "album", dataset: { i18n: "plex.type.album" } }, t("plex.type.album") || "Album"),
        el("option", { value: "artist", dataset: { i18n: "plex.type.artist" } }, t("plex.type.artist") || "Artist"),
    ]);

    const itemSelect = el("select", { class: "path-input" });

    const castBtn = el("button", { type: "button", class: "btn ghost", dataset: { i18n: "btn.cast" } }, t("btn.cast"));
    const saveBtn = el("button", { type: "button", class: "btn filled", dataset: { i18n: "btn.save" } }, t("btn.save"));
    const shuffleBtn = el("button", {
        type: "button", class: "icon-btn", "aria-label": t("plex.toggle_shuffle"),
        dataset: { i18nAriaLabel: "plex.toggle_shuffle" }, html: icons.shuffle,
    });
    const summaryEl = el("p", { class: "muted", hidden: true });
    let lastDetails = null;

    let isLoadingDirectory = false;
    let loadedType = null;

    async function refreshItems() {
        const type = typeSelect.value;
        if (isLoadingDirectory) return;
        if (loadedType === type && itemSelect.options.length > 1) return;

        isLoadingDirectory = true;
        itemSelect.innerHTML = "";
        const loadingOpt = el("option", { disabled: true, selected: true, dataset: { i18n: "label.loading" } }, t("label.loading"));
        itemSelect.appendChild(loadingOpt);
        
        try {
            const data = await api.plex.getDirectory(type);
            itemSelect.innerHTML = "";
            if (!data || data.length === 0) {
                itemSelect.appendChild(el("option", { disabled: true, selected: true, dataset: { i18n: "label.no_matches" } }, t("label.no_matches")));
                loadedType = type;
                return;
            }
            
            for (const item of data) {
                let text = item.title;
                if (item.artist) text = `${item.artist} - ${text}`;
                itemSelect.appendChild(el("option", { value: item.id }, text));
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
        api: api.plex,
        newStation,
        defaultNameKey: "plex.default_station_name",
        ctx,
        queue: {
            getTitle: track => track.title,
            getSubtitle: track => track.artist || null,
            getCoverUrl: track => track.cover_url,
            getSearchFields: track => [track.title || "", track.artist || ""],
        },
        getSig: details => `${details?.queue_size ?? -1}|${details?.queue_cursor ?? -1}`,
        onAir: async () => {
            await api.switchSource("plex");
            await api.transport("plex", "play");
        },
        onStationChange: s => {
            const newType = s?.target_type || "playlist";
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

    const card = el("section", { class: "card", id: "plex-card", hidden: true }, [
        el("h2", { dataset: { i18n: "plex.title" } }, t("plex.title")),
        summaryEl,
        el("div", { class: "stationbar row" }, [stationSelect, onAirBtn]),
        el("div", { class: "row stationtools" }, [newBtn, duplicateBtn, renameBtn, deleteBtn]),
        el("div", { class: "editor" }, [
            el("label", { class: "field-label", dataset: { i18n: "plex.target_type" } }, t("plex.target_type") || "Type"),
            typeSelect,
            el("label", { class: "field-label", dataset: { i18n: "plex.target_item" } }, t("plex.target_item") || "Item"),
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
            toast(t("plex.stations_saved"));
        } catch {
            // error handling already deferred to the station manager
        }
    });

    castBtn.addEventListener("click", async () => {
        const type = typeSelect.value;
        const id = itemSelect.value;
        if (!id) return;
        typeSelect.disabled = true;
        itemSelect.disabled = true;
        castBtn.disabled = true;
        try {
            await api.plex.cast(type, id);
            toast(t("toast.casting", { service: "Plex" }));
            await ctx.onSaved?.();
            station.loadQueue();
        } catch (e) {
            toast(e.message, true);
        } finally {
            typeSelect.disabled = false;
            itemSelect.disabled = false;
            castBtn.disabled = false;
        }
    });

    shuffleBtn.addEventListener("click", async () => {
        const isShuffled = shuffleBtn.classList.contains("toggled");
        try {
            await api.plex.shuffle(!isShuffled);
            toast(!isShuffled ? t("toast.shuffle_on") : t("toast.shuffle_off"));
            await ctx.onSaved?.();
            station.loadQueue();
        } catch (e) {
            toast(e.message, true);
        }
    });

    function render() {
        const state = ctx.getState();
        const isActive = state?.sources?.active === "plex";
        card.hidden = !isActive;
        if (!isActive) return;
        station.load();
        const details = state?.sources?.available?.find(s => s.name === "plex")?.details;
        station.sync(details);
        
        // ensure options are loaded if active
        if (loadedType !== typeSelect.value) {
            refreshItems();
        }
    }

    return { render, invalidate: station.invalidate };
}
